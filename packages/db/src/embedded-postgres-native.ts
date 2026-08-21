// [Input] embedded-postgres optional native package for the current Linux architecture.
// [Output] Runtime library aliases and LD_LIBRARY_PATH required by packaged PostgreSQL.
// [Pos] Native compatibility seam adapted from Paperclip packages/db.
// [Sync] 2026-08-21: add Linux native preparation for the embedded PostgreSQL runtime.
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function nativePackageName(): string | null {
  if (process.platform !== "linux") return null;
  return ({
    arm64: "linux-arm64",
    arm: "linux-arm",
    ia32: "linux-ia32",
    ppc64: "linux-ppc64",
    x64: "linux-x64",
  } as Record<string, string>)[process.arch] ?? null;
}

async function exists(value: string): Promise<boolean> {
  try {
    await fs.stat(value);
    return true;
  } catch {
    return false;
  }
}

export async function ensureLinuxSharedLibraryAliases(libDir: string): Promise<void> {
  const entries = await fs.readdir(libDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(lib.+\.so\.\d+)\.\d+(?:\.\d+)?$/);
    if (!match) continue;
    try {
      await fs.symlink(entry.name, path.join(libDir, match[1]));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
}

export async function prepareEmbeddedPostgresNativeRuntime(): Promise<void> {
  const packageName = nativePackageName();
  if (!packageName) return;
  let packageRoot: string;
  try {
    packageRoot = path.dirname(path.dirname(require.resolve("embedded-postgres")));
  } catch {
    return;
  }
  const libDir = path.resolve(packageRoot, "..", "@embedded-postgres", packageName, "native/lib");
  if (!(await exists(libDir))) return;
  const current = (process.env.LD_LIBRARY_PATH ?? "").split(path.delimiter).filter(Boolean);
  if (!current.includes(libDir)) process.env.LD_LIBRARY_PATH = [libDir, ...current].join(path.delimiter);
  await ensureLinuxSharedLibraryAliases(libDir);
}
