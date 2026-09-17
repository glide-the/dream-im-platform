// [Input] Exact configured Dream origin and bounded browser form fields.
// [Output] Better Auth email/register/Google navigation with only provider cookies and safe redirects.
// [Pos] Admin-owned Dream login interaction; Dream renders the form but never receives credentials.
// [Sync] 2026-09-17: restore Dream's product login form while retaining Admin as the sole credential/session authority.
import { APIError } from "better-auth/api";
import { z } from "zod";
import { AuthBoundaryError, dreamServiceClients, type DreamServiceClient } from "./config";
import { createAdminAuth } from "./server";
import { withAuthTransaction } from "./database";
import { productPasswordMinimumLength } from "./password";

const returnLocationDto = z.string().min(1).max(2_048).transform(relativeDreamReturnLocation);
const passwordEntryDto = z.strictObject({
  mode: z.enum(["login", "register"]),
  email: z.email().max(320),
  password: z.string().min(1).max(256),
  name: z.string().max(120).optional(),
  return_to: returnLocationDto,
}).superRefine((input, context) => {
  if (input.mode === "register" && input.password.length < productPasswordMinimumLength) {
    context.addIssue({ code: "too_small", origin: "string", minimum: productPasswordMinimumLength, inclusive: true, path: ["password"], message: "Password is too short." });
  }
});
const googleEntryDto = z.strictObject({ return_to: returnLocationDto });

type PasswordEntry = z.output<typeof passwordEntryDto>;
type GoogleEntry = z.output<typeof googleEntryDto>;
export type DreamBrowserEntryProtocol = Readonly<{
  password(input: PasswordEntry, request: Request, callbackURL: string): Promise<Response>;
  google(input: GoogleEntry, request: Request, callbackURL: string, errorCallbackURL: string): Promise<Response>;
}>;

function hasControlCharacter(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function relativeDreamReturnLocation(raw: string): string {
  let decoded = raw;
  for (;;) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || hasControlCharacter(decoded)) {
      throw new AuthBoundaryError("AUTH_RETURN_LOCATION_INVALID", 400);
    }
    let next: string;
    try { next = decodeURIComponent(decoded); }
    catch { throw new AuthBoundaryError("AUTH_RETURN_LOCATION_INVALID", 400); }
    if (next === decoded) return raw;
    decoded = next;
  }
}

function requestService(request: Request): DreamServiceClient {
  const origin = request.headers.get("origin");
  const matches = dreamServiceClients().filter(service => service.origin === origin);
  if (matches.length !== 1) throw new AuthBoundaryError("AUTH_ORIGIN_DENIED", 403);
  return matches[0];
}

async function readForm<T extends z.ZodType>(request: Request, schema: T, allowed: ReadonlySet<string>): Promise<z.output<T>> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/x-www-form-urlencoded") {
    throw new AuthBoundaryError("FORM_REQUIRED", 415);
  }
  const maximum = Number(process.env.AUTH_MAX_BODY_BYTES ?? 16_384);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new AuthBoundaryError("AUTH_REQUEST_POLICY_INVALID");
  const reader = request.body?.getReader();
  if (!reader) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new AuthBoundaryError("INPUT_TOO_LARGE", 413); }
      chunks.push(next.value);
    }
    const parameters = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    for (const key of parameters.keys()) {
      if (!allowed.has(key) || parameters.getAll(key).length !== 1) throw new AuthBoundaryError("INPUT_INVALID", 400);
    }
    const parsed = schema.safeParse(Object.fromEntries(parameters));
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    return parsed.data;
  } finally { reader.releaseLock(); }
}

function startURL(service: DreamServiceClient, returnTo: string) {
  const target = new URL("/auth/start", service.origin);
  target.searchParams.set("return_to", returnTo);
  return target.href;
}

function failureURL(service: DreamServiceClient, returnTo: string, code: "credentials" | "registration" | "google") {
  const target = new URL(returnTo, service.origin);
  target.searchParams.set("auth_error", code);
  return target.href;
}

function copyProtocolCookies(source: Response, destination: Headers) {
  for (const cookie of source.headers.getSetCookie()) destination.append("set-cookie", cookie);
}

function requestsJson(request: Request) {
  return request.headers.get("accept")?.split(",").some(value => value.trim().split(";", 1)[0] === "application/json") ?? false;
}

function navigationResponse(request: Request, service: DreamServiceClient, location: string, protocol?: Response, status = 200) {
  if (requestsJson(request)) {
    const headers = new Headers({
      "access-control-allow-credentials": "true",
      "access-control-allow-origin": service.origin,
      "cache-control": "no-store",
      pragma: "no-cache",
      vary: "Origin",
    });
    if (protocol) copyProtocolCookies(protocol, headers);
    return Response.json(status < 400 ? { next_url: location } : { error: { code: new URL(location).searchParams.get("auth_error") } }, { status, headers });
  }
  const headers = new Headers({ location, "cache-control": "no-store", pragma: "no-cache", "referrer-policy": "no-referrer" });
  if (protocol) copyProtocolCookies(protocol, headers);
  return new Response(null, { status: 303, headers });
}

function defaultProtocol(): DreamBrowserEntryProtocol {
  return {
    async password(input, request, callbackURL) {
      return withAuthTransaction(async tx => {
        const auth = createAdminAuth(tx);
        const headers = new Headers(request.headers);
        return input.mode === "register"
          ? auth.api.signUpEmail({ body: { email: input.email, password: input.password, name: input.name?.trim() ?? "", callbackURL }, headers, asResponse: true })
          : auth.api.signInEmail({ body: { email: input.email, password: input.password, rememberMe: true, callbackURL }, headers, asResponse: true });
      });
    },
    async google(_input, request, callbackURL, errorCallbackURL) {
      return withAuthTransaction(tx => createAdminAuth(tx).api.signInSocial({
        body: { provider: "google", callbackURL, errorCallbackURL }, headers: new Headers(request.headers), asResponse: true,
      }));
    },
  };
}

export async function handleDreamPasswordEntry(request: Request, protocol: DreamBrowserEntryProtocol = defaultProtocol()) {
  const service = requestService(request);
  let input: PasswordEntry;
  try { input = await readForm(request, passwordEntryDto, new Set(["mode", "email", "password", "name", "return_to"])); }
  catch (error) {
    if (error instanceof AuthBoundaryError) throw error;
    throw new AuthBoundaryError("INPUT_INVALID", 400);
  }
  const callbackURL = startURL(service, input.return_to);
  try {
    const response = await protocol.password(input, request, callbackURL);
    if (!response.ok) return navigationResponse(request, service, failureURL(service, input.return_to, input.mode === "register" ? "registration" : "credentials"), undefined, 401);
    return navigationResponse(request, service, callbackURL, response);
  } catch (error) {
    if (error instanceof APIError) return navigationResponse(request, service, failureURL(service, input.return_to, input.mode === "register" ? "registration" : "credentials"), undefined, 401);
    throw error;
  }
}

export async function handleDreamGoogleEntry(request: Request, protocol: DreamBrowserEntryProtocol = defaultProtocol()) {
  const service = requestService(request);
  const input = await readForm(request, googleEntryDto, new Set(["return_to"]));
  const callbackURL = startURL(service, input.return_to);
  const errorCallbackURL = failureURL(service, input.return_to, "google");
  try {
    const response = await protocol.google(input, request, callbackURL, errorCallbackURL);
    const destination = response.headers.get("location");
    if (!response.ok || !destination) return navigationResponse(request, service, errorCallbackURL, undefined, 400);
    const parsed = new URL(destination);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new AuthBoundaryError("AUTH_PROVIDER_RESPONSE_INVALID");
    return navigationResponse(request, service, parsed.href, response);
  } catch (error) {
    if (error instanceof APIError) return navigationResponse(request, service, errorCallbackURL, undefined, 400);
    throw error;
  }
}

export function dreamBrowserEntryFailure(error: unknown) {
  const boundary = error instanceof AuthBoundaryError ? error : new AuthBoundaryError("AUTH_SERVICE_UNAVAILABLE");
  return Response.json({ error: { code: boundary.code, message: boundary.status >= 500 ? "Authentication is unavailable." : "This request could not be completed." } }, { status: boundary.status, headers: { "cache-control": "no-store" } });
}
