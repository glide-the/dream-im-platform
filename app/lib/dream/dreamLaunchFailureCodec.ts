// [Input] Server-derived stored source metadata and original terminal error; no path/action selector.
// [Output] Fixed Python-compatible raw failure envelope preserving numeric and unknown metadata bytes.
// [Pos] Server-only failure codec binding; database/UOW/Runtime are outside this pure transport.
// [Sync] 2026-09-15: bind registered77 to the fixed standalone failure script without caller codec choice.
import { z } from "zod";
import { invokeFixedDomainCodec } from "./fixedDomainCodec";
import type { DreamLaunchFailureOverlay } from "./dreamLaunchFailureService";
export const encodeDreamLaunchFailureEnvelope: DreamLaunchFailureOverlay = async (metadata, error_code) =>
  z.strictObject({ metadata_json: z.string() }).parse(await invokeFixedDomainCodec("launchFailureEnvelope", { metadata, error_code }));
