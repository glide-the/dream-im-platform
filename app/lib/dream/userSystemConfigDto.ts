// [Input] Dream-normalized Settings patch and verified actor, without caller SQL/key/identity selectors.
// [Output] Closed ten-field commands and raw Python JSON result preserving stored numeric categories.
// [Pos] Unregistered SystemConfig DTO; five-field Preferences remains separate.
// [Sync] 2026-09-15: original codepoint bounds, model/provider pair and managed env ownership.
import { z } from "zod";
import { stripPythonString } from "./deckPluginManifestDto";
import { userSystemConfigPolicy as p, systemConfigServerEnvKeys, systemConfigSecretEnvPattern } from "../../../config/user-system-config-policy";
const characters = (maximum: number) => z.string().refine(value => Array.from(value).length <= maximum);
const domain = characters(p.domainCharacters).regex(/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const path = characters(p.pathCharacters).refine(value => value.startsWith("/") && (value === "/" || !value.endsWith("/")));
const distinct = <T extends z.ZodType>(item: T, maximum: number) => z.array(item).max(maximum).refine(values => new Set(values).size === values.length);
const envKey = characters(p.envKeyCharacters).refine(value => value !== "" && stripPythonString(value) === value &&
  !systemConfigServerEnvKeys.has(value.toUpperCase()) && !systemConfigSecretEnvPattern.test(value));
const envValue = characters(p.envValueCharacters).refine(value => stripPythonString(value) === value);
export const userSystemConfigPatchDto = z.strictObject({
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/).optional(), provider: z.literal("gateway").optional(),
  system_prompt: characters(p.promptCharacters).optional(), workspace_enabled: z.boolean().optional(),
  sandbox_network_mode: z.enum(["disabled", "allowlist", "open"]).optional(),
  sandbox_network_allowed_domains: distinct(domain, p.domainEntries).optional(),
  sandbox_fs_allowed_write_paths: distinct(path, p.pathEntries).optional(), im_full_access_enabled: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  env_vars: z.record(envKey, envValue).refine(value => Object.keys(value).length <= p.envEntries).optional(),
}).refine(value => (value.model === undefined) === (value.provider === undefined));
export const userSystemConfigReadOutputDto = z.strictObject({ config_json: z.string().min(1) });
export const userSystemConfigPatchOutputDto = z.strictObject({ success: z.literal(true) });
export const userSystemConfigOperationContracts = {
  "user-system-config.get": { kind: "read" as const, input: z.strictObject({}), output: userSystemConfigReadOutputDto, userScope: "dream:read" },
  "user-system-config.patch": { kind: "write" as const, input: userSystemConfigPatchDto, output: userSystemConfigPatchOutputDto, userScope: "dream:write" },
};
export type UserSystemConfigPatch = z.output<typeof userSystemConfigPatchDto>;
export type UserSystemConfigOperation = keyof typeof userSystemConfigOperationContracts;
