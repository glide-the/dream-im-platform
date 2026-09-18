// [Input] Dream browser form requests and an injected Better Auth protocol boundary.
// [Output] Origin, DTO, redirect and credential-containment contract evidence.
// [Pos] Provider-free tests for the Admin-owned Dream browser login ingress.
// [Sync] 2026-09-18: cover initiating-origin redirects for local and public Dream browser entry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleDreamGoogleEntry,
  handleDreamPasswordEntry,
  relativeDreamReturnLocation,
  type DreamBrowserEntryProtocol,
} from "./dreamBrowserEntry";

const dreamOrigin = "https://dream.example";
const service = {
  id: "dream",
  secret: "s".repeat(32),
  origin: dreamOrigin,
  oauthClientId: "dream-browser",
  redirectUri: `${dreamOrigin}/auth/callback`,
  backgroundScopes: ["capabilities:read"],
};

function form(path: string, fields: Record<string, string>, origin = dreamOrigin) {
  return new Request(`https://admin.example${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

function protocol(overrides: Partial<DreamBrowserEntryProtocol> = {}): DreamBrowserEntryProtocol {
  return {
    password: vi.fn(async () => new Response(JSON.stringify({ user: { id: "private" } }), {
      headers: [["content-type", "application/json"], ["set-cookie", "better-auth.session=opaque; HttpOnly; SameSite=Lax"]],
    })),
    google: vi.fn(async () => new Response(JSON.stringify({ redirect: true }), {
      headers: [["location", "https://accounts.google.com/o/oauth2/v2/auth?state=opaque"], ["set-cookie", "better-auth.state=opaque; HttpOnly; SameSite=Lax"]],
    })),
    ...overrides,
  };
}

beforeEach(() => vi.stubEnv("DREAM_DATA_SERVICE_CLIENTS", JSON.stringify([service])));
afterEach(() => vi.unstubAllEnvs());

describe("Dream browser entry", () => {
  it("creates the Admin session then enters the existing Dream PKCE flow", async () => {
    const auth = protocol();
    const response = await handleDreamPasswordEntry(form("/auth/dream/password", {
      mode: "login", email: "member@example.com", password: "private-value", return_to: "/story-workspace/chat?deck=1",
    }), auth);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${dreamOrigin}/auth/start?return_to=%2Fstory-workspace%2Fchat%3Fdeck%3D1`);
    expect(response.headers.getSetCookie()).toContain("better-auth.session=opaque; HttpOnly; SameSite=Lax");
    expect(await response.text()).toBe("");
    expect(response.headers.get("location")).not.toContain("member%40example.com");
    expect(response.headers.get("location")).not.toContain("private-value");
    expect(auth.password).toHaveBeenCalledWith(expect.objectContaining({ mode: "login", email: "member@example.com" }), expect.any(Request), `${dreamOrigin}/auth/start?return_to=%2Fstory-workspace%2Fchat%3Fdeck%3D1`);
  });

  it("accepts any browser origin but rejects duplicate fields and non-relative returns before authentication", async () => {
    const auth = protocol();
    const otherOriginRequest = form("/auth/dream/password", {
      mode: "login", email: "member@example.com", password: "private-value", return_to: "/",
    }, "https://other.example");
    otherOriginRequest.headers.set("accept", "application/json");
    const otherOriginResponse = await handleDreamPasswordEntry(otherOriginRequest, auth);
    expect(otherOriginResponse.status).toBe(200);
    expect(otherOriginResponse.headers.get("access-control-allow-origin")).toBe("https://other.example");
    expect(await otherOriginResponse.json()).toEqual({ next_url: "https://other.example/auth/start?return_to=%2F" });

    const duplicate = new URLSearchParams({ mode: "login", email: "member@example.com", password: "private-value", return_to: "/" });
    duplicate.append("email", "second@example.com");
    await expect(handleDreamPasswordEntry(new Request("https://admin.example/auth/dream/password", {
      method: "POST", headers: { origin: dreamOrigin, "content-type": "application/x-www-form-urlencoded" }, body: duplicate,
    }), auth)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });

    expect(() => relativeDreamReturnLocation("https://other.example/")).toThrow("AUTH_RETURN_LOCATION_INVALID");
    expect(() => relativeDreamReturnLocation("/%2fother.example/")).toThrow("AUTH_RETURN_LOCATION_INVALID");
    expect(auth.password).toHaveBeenCalledTimes(1);
  });

  it("returns a localhost Dream login to the same localhost origin", async () => {
    const localhostOrigin = "http://localhost:5173";
    vi.stubEnv("DREAM_DATA_SERVICE_CLIENTS", JSON.stringify([
      service,
      { ...service, id: "dream-local", origin: localhostOrigin, oauthClientId: "dream-browser-local", redirectUri: `${localhostOrigin}/auth/callback` },
    ]));
    const request = form("/auth/dream/google", { return_to: "/story-workspace/chat?deck=local" }, localhostOrigin);
    request.headers.set("accept", "application/json");
    const auth = protocol();

    const response = await handleDreamGoogleEntry(request, auth);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(localhostOrigin);
    expect(auth.google).toHaveBeenCalledWith(
      expect.objectContaining({ return_to: "/story-workspace/chat?deck=local" }),
      expect.any(Request),
      "http://localhost:5173/auth/start?return_to=%2Fstory-workspace%2Fchat%3Fdeck%3Dlocal",
      "http://localhost:5173/story-workspace/chat?deck=local&auth_error=google",
    );
  });

  it("returns only a safe product error when credentials are rejected", async () => {
    const auth = protocol({ password: vi.fn(async () => Response.json({ detail: "private upstream reason" }, { status: 401 })) });
    const response = await handleDreamPasswordEntry(form("/auth/dream/password", {
      mode: "login", email: "member@example.com", password: "private-value", return_to: "/story-workspace/chat?deck=1",
    }), auth);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${dreamOrigin}/story-workspace/chat?deck=1&auth_error=credentials`);
    expect(await response.text()).toBe("");
  });

  it("supports exact-origin credentialed browser fetch without exposing the Better Auth response", async () => {
    const auth = protocol();
    const request = form("/auth/dream/password", {
      mode: "login", email: "member@example.com", password: "private-value", return_to: "/story-workspace/chat",
    });
    request.headers.set("accept", "application/json");
    const response = await handleDreamPasswordEntry(request, auth);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(dreamOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.getSetCookie()).toContain("better-auth.session=opaque; HttpOnly; SameSite=Lax");
    expect(await response.json()).toEqual({ next_url: `${dreamOrigin}/auth/start?return_to=%2Fstory-workspace%2Fchat` });
  });

  it("enforces the product registration password policy before Better Auth", async () => {
    const auth = protocol();
    await expect(handleDreamPasswordEntry(form("/auth/dream/password", {
      mode: "register", name: "Member", email: "member@example.com", password: "short", return_to: "/",
    }), auth)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
    expect(auth.password).not.toHaveBeenCalled();
  });

  it("forwards only a validated HTTPS Google authorization destination", async () => {
    const auth = protocol();
    const response = await handleDreamGoogleEntry(form("/auth/dream/google", { return_to: "/story-workspace/chat" }), auth);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=opaque");
    expect(response.headers.getSetCookie()).toContain("better-auth.state=opaque; HttpOnly; SameSite=Lax");

    const unsafe = protocol({ google: vi.fn(async () => new Response(null, { headers: { location: "http://accounts.google.com/" } })) });
    await expect(handleDreamGoogleEntry(form("/auth/dream/google", { return_to: "/" }), unsafe)).rejects.toMatchObject({ code: "AUTH_PROVIDER_RESPONSE_INVALID" });
  });

  it("returns the Google destination as a bounded CORS DTO for the Dream product card", async () => {
    const request = form("/auth/dream/google", { return_to: "/story-workspace/chat" });
    request.headers.set("accept", "application/json");
    const response = await handleDreamGoogleEntry(request, protocol());
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(dreamOrigin);
    expect(await response.json()).toEqual({ next_url: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque" });
  });
});
