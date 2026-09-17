// [Input] Installed Better Auth fetch response or restricted local login continuation.
// [Output] Protocol-provided HTTP(S) redirect and Google callback preserving signed OAuth state.
// [Pos] Browser navigation helper; grant validation remains in the installed server plugin.
export function authResponseRedirect(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string") return null;
  try {
    const url = new URL(data.url, "https://local.invalid");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? data.url : null;
  } catch { return null; }
}
export function googleLoginCallback(origin: string, returnTo: string, search: string): string {
  // OAuth-provider's client submits the signed oauth_query and persists it in
  // OAuth state. Returning to the login page also preserves the UI context if
  // the provider requires another interaction after the Google callback.
  const params = new URLSearchParams(search);
  return params.has("sig") ? `${origin}/auth/sign-in${search.startsWith("?") ? search : `?${search}`}` : new URL(returnTo, origin).toString();
}
