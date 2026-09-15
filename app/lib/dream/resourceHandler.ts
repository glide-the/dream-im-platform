// [Input] Internal service request with strict operation DTO.
// [Output] Standard domain response envelope; scope/UOW/ORM reside below ingress.
// [Pos] Thin policy/observer request orchestration.
// [Sync] 2026-09-14: expose only named background operations.
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { resourcePolicyReadRequestDto, resourceObserverPublishRequestDto } from "./resourceDto";
import { readResourcePolicy, publishResourceObserver } from "./resourceService";
export async function handleResourcePolicyRead(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => { const requestDto = await parseAuthDto(request, resourcePolicyReadRequestDto); setRequestId(requestDto.request_id); return readResourcePolicy(service); });
}
export async function handleResourceObserverPublish(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => { const requestDto = await parseAuthDto(request, resourceObserverPublishRequestDto); setRequestId(requestDto.request_id); return publishResourceObserver(service, requestDto.input, requestDto.request_id); });
}
