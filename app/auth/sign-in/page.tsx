// [Input] Provider-signed OAuth continuation or restricted local device return.
// [Output] Password/register/Google login with preserved provider context.
// [Pos] Unified Admin login entry.
import { localLoginReturn, searchParamsFromPage } from "../../lib/auth/pageContext";
import AuthSignIn from "./AuthSignIn";
export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AuthSignIn returnTo={localLoginReturn(searchParamsFromPage(await searchParams))} />;
}
