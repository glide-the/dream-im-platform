// [Input] Installed provider-signed OAuth query and registered client metadata.
// [Output] Verified consent display or actionable expired-context feedback.
// [Pos] Admin OAuth authorization page.
import { readConsentContext, searchParamsFromPage } from "../../lib/auth/pageContext";
import AuthConsent from "./AuthConsent";
export const dynamic = "force-dynamic";
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let context: Awaited<ReturnType<typeof readConsentContext>> | null = null;
  try { context = await readConsentContext(searchParamsFromPage(await searchParams)); } catch { /* safe unavailable context */ }
  return context ? <AuthConsent context={context} /> : <><h1 className="text-2xl font-semibold">授权请求不可用</h1><p className="mt-4 text-text-secondary">请回到发起登录的应用，重新开始登录。</p></>;
}
