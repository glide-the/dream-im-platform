// [Input] Internal browser-session exchange/resolve/revoke request and strict DTO.
// [Output] Client-bound handle/token projection; expected OAuth failures commit their recovery state.
// [Pos] Thin domain ingress orchestration; repository/service own ORM transactions.
// [Sync] 2026-09-14: add BFF auth handle APIs without exposing tokens to browser DTOs.
import { browserExchangeDto, browserHandleDto, browserRevokeResultDto } from "./dto";
import { BrowserSessionService } from "./browserSessionService";
import { handleInternalAuthRequest, parseAuthDto } from "./internalHandler";
import { withAuthTransaction } from "./database";

export async function handleBrowserExchange(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, browserExchangeDto); setRequestId(input.request_id);
    const result = await withAuthTransaction(tx => new BrowserSessionService(tx, service).exchange(input));
    if (result.error) throw result.error;
    return result.data;
  });
}
export async function handleBrowserResolve(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, browserHandleDto); setRequestId(input.request_id);
    const result = await withAuthTransaction(tx => new BrowserSessionService(tx, service).resolve(input.handle));
    if (result.error) throw result.error;
    return result.data;
  });
}
export async function handleBrowserRevoke(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, browserHandleDto); setRequestId(input.request_id);
    return browserRevokeResultDto.parse(await withAuthTransaction(tx => new BrowserSessionService(tx, service).revoke(input.handle)));
  });
}
