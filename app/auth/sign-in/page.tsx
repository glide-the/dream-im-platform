// [Input] Provider-signed OAuth continuation or restricted local device return.
// [Output] Password/register/Google login with preserved provider context.
// [Pos] Unified Admin login entry.
// [Sync] 2026-11-02: preserve the user's signed Google selection through the system browser entry.
import { localLoginReturn, searchParamsFromPage, selectedGoogleLogin } from "../../lib/auth/pageContext";
import { authConfiguration } from "../../lib/auth/config";
import AuthSignIn from "./AuthSignIn";
export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = searchParamsFromPage(await searchParams);
  const google = await selectedGoogleLogin(query, authConfiguration().secret);
  return <AuthSignIn returnTo={localLoginReturn(query)} selectedGoogle={google} />;
}
