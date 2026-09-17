// [Input] Actual original Dream get/save source and independent pure SystemConfig codec candidate.
// [Output] Complete source result/parameter/commit/close parity and explicit fail-closed conflicts.
// [Pos] Provider-free actual source validation; no production SQL/credentials or codec map activation.
// [Sync] 2026-09-15: run source parity only with explicit Dream source and oracle interpreter.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
const actor = "9007199254740993", root = process.env.INK_DREAM_SOURCE;
const rich = '{"large":9007199254740993,"float":1.0,"negative":-0.0,"文字":"Ω","unknown":{"counter":9007199254740995},"env_vars":{"OLD":"value"}}';
const cases = [
 { actor, exists: false, raw: null, patch: { theme: "dark" } },
 { actor, exists: true, raw: null, patch: { workspace_enabled: false } },
 { actor, exists: true, raw: "", patch: {} },
 { actor, exists: true, raw: "{}", patch: { system_prompt: "" } },
 { actor, exists: true, raw: rich, patch: { theme: "light" } },
 { actor, exists: true, raw: rich, patch: { env_vars: { LANG: "zh_CN.UTF-8" } } },
 { actor, exists: true, raw: '{"theme":"light","unknown":{"raw":9007199254740993}}', patch: { theme: "dark", model: "platform:model-1", provider: "gateway" } },
 { actor, exists: true, raw: rich, patch: { model: "platform:model-1", provider: "gateway", system_prompt: "文字😀", workspace_enabled: false, sandbox_network_mode: "allowlist", sandbox_network_allowed_domains: ["*.example.com"], sandbox_fs_allowed_write_paths: ["/work"], im_full_access_enabled: true, theme: "system", env_vars: { LANG: "" } } },
 { actor, exists: true, raw: rich, patch: { theme: "dark" }, fail_write: true },
 { actor, exists: true, raw: "broken", patch: {} },
 { actor, exists: true, raw: "[]", patch: {} },
 { actor, exists: true, raw: "null", patch: {} },
 { actor, exists: true, raw: '{"invalid":NaN}', patch: {} },
 { actor, exists: true, raw: '{"invalid":1e309}', patch: {} },
];
function codec(action: string, raw: string | null, patch?: unknown) {
 const input = action === "read" ? { action, stored_json: raw } : { action, stored_json: raw, patch };
 const child = spawnSync("python3", ["-I", "-S", resolve("app/lib/dream/userSystemConfigCodec.py")], { encoding: "utf8", timeout: 15000, env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, input: JSON.stringify(input) });
 expect(child.error).toBeUndefined(); return child;
}
it.skipIf(!process.env.INK_DREAM_SOURCE || !process.env.INK_DREAM_ORACLE_PYTHON)("actual whole original get/save fourteen positional cases and explicit invalid-data boundary", () => {
 expect(root).toBeTruthy(); const python = process.env.INK_DREAM_ORACLE_PYTHON;
 expect(python).toBeTruthy(); const child = spawnSync(python!, ["-B", resolve("tests/integration/userSystemConfigSourceOracle.py")], { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH, INK_DREAM_SOURCE: root } as unknown as NodeJS.ProcessEnv, input: JSON.stringify({ cases }) });
 expect(child.error).toBeUndefined(); expect(child.status).toBe(0);
 const results = JSON.parse(child.stdout) as { read_config_json: string | null; read_error: string | null; save_error: string | null; read_parameters: string[][]; save_parameters: string[][]; read_commits: number; save_commits: number; read_closes: number; save_closes: number }[];
 expect(results).toHaveLength(cases.length);
 cases.forEach((c, i) => {
  const original = results[i]; expect(original.read_parameters).toEqual([[actor]]); expect(original.save_parameters[0]).toEqual([actor]);
  expect([original.read_commits, original.read_closes, original.save_closes]).toEqual([0, 1, 1]);
  const read = codec("read", c.raw), merge = codec("merge", c.raw, c.patch);
  if (i < 9) {
   expect(read.status).toBe(0); expect(JSON.parse(read.stdout)).toEqual({ config_json: original.read_config_json });
   expect(merge.status).toBe(0); const merged = (JSON.parse(merge.stdout) as { config_json: string }).config_json;
   expect(original.save_parameters[1]).toEqual(c.exists ? [merged, actor] : [actor, merged]);
   expect([original.read_error, original.save_error, original.save_commits]).toEqual([null, c.fail_write ? "RuntimeError" : null, c.fail_write ? 0 : 1]);
  } else {
   expect(read.status).toBe(1); expect(merge.status).toBe(1); expect(read.stderr.trim()).toBe("System configuration codec failed");
   if (i === 9) expect([original.read_error, original.save_error, original.save_commits]).toEqual(["JSONDecodeError", "JSONDecodeError", 0]);
   if ([10, 11].includes(i)) expect([original.read_error, original.save_error, original.save_commits]).toEqual([null, "AttributeError", 0]);
   if ([12, 13].includes(i)) expect([original.read_error, original.save_error, original.save_commits]).toEqual([null, null, 1]);
  }
 });
});
