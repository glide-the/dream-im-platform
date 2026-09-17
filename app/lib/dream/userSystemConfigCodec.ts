// [Input] Fixed UserSystemConfig read/merge request selected by the domain service.
// [Output] Strict pure-codec result transported through the shared fixed executable boundary.
// [Pos] Server-only wrapper; callers cannot choose a path, executable or arbitrary action.
// [Sync] 2026-09-15: bind the verified stdlib codec as the mandatory production implementation.
import { invokeFixedDomainCodec } from "./fixedDomainCodec";
import type { UserSystemConfigCodec } from "./userSystemConfigService";
export const encodeUserSystemConfig: UserSystemConfigCodec = input => invokeFixedDomainCodec("userSystemConfig", input);
