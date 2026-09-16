// [Input] Temporary Git repositories and the production release-binding helper/activation entrypoint.
// [Output] Deterministic proof for exact HEAD, dirty tracked files, cross-project mismatch and v1 rejection.
// [Pos] Provider-free configuration test for the separately approved normal cutover gate.
// [Sync] 2026-09-16: cover exact clean Admin/Dream release binding before backup or database access.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { verifyGitReleaseBinding } from "./unified-auth-data-release-binding.mjs";

const execFileAsync = promisify(execFile);

async function git(directory, args) {
  return (await execFileAsync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  })).stdout.trim();
}

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), "ink-auth-data-release-"));
  await git(directory, ["init", "--quiet"]);
  await writeFile(join(directory, "release.txt"), "release\n");
  await git(directory, ["add", "release.txt"]);
  await git(directory, ["-c", "user.name=Ink Test", "-c", "user.email=ink@example.invalid", "commit", "--quiet", "-m", "release"]);
  return { directory, head: await git(directory, ["rev-parse", "HEAD"]) };
}

test("verifies an exact tracked-clean release and ignores untracked cache", async () => {
  const repo = await repository();
  try {
    await writeFile(join(repo.directory, ".pnpm-store"), "cache\n");
    assert.deepEqual(await verifyGitReleaseBinding({
      directory: repo.directory,
      expectedCommit: repo.head,
      codePrefix: "AUTH_DATA_DREAM_RELEASE",
    }), { directory: await realpath(repo.directory), head: repo.head });
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
});

test("rejects commit mismatch before accepting a release", async () => {
  const repo = await repository();
  try {
    await assert.rejects(
      verifyGitReleaseBinding({
        directory: repo.directory,
        expectedCommit: "0".repeat(40),
        codePrefix: "AUTH_DATA_ADMIN_RELEASE",
      }),
      { message: "AUTH_DATA_ADMIN_RELEASE_COMMIT_MISMATCH" },
    );
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
});

test("rejects tracked release edits", async () => {
  const repo = await repository();
  try {
    await writeFile(join(repo.directory, "release.txt"), "changed\n");
    await assert.rejects(
      verifyGitReleaseBinding({
        directory: repo.directory,
        expectedCommit: repo.head,
        codePrefix: "AUTH_DATA_DREAM_RELEASE",
      }),
      { message: "AUTH_DATA_DREAM_RELEASE_WORKTREE_DIRTY" },
    );
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
});

test("activation rejects the superseded v1 manifest before database access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ink-auth-data-manifest-"));
  try {
    const manifest = join(directory, "activation.json");
    await writeFile(manifest, `${JSON.stringify({
      schema: "admin-auth-data-cutover/v1",
      admin_commit: "0".repeat(40),
      database: { name: "ink-memory", port: 54329, data_directory: "/private/postgres", migrations_before: 54, migrations_target: 63 },
      backup: { path: "/private/backup.tar.gz", sha256: "0".repeat(64) },
      roles: {
        auth: { name: "ink_auth", password: "a".repeat(32) },
        control: { name: "ink_admin_control", password: "b".repeat(32) },
        data: { name: "ink_dream_data", password: "c".repeat(32) },
        dream: { name: "ink_dream_no_db", login: false },
      },
      gateway_client_id: "ink-dream-memory",
      activation_state: "prepared-not-applied",
    }, null, 2)}\n`, { mode: 0o600 });
    await chmod(manifest, 0o600);
    await assert.rejects(
      execFileAsync(process.execPath, [resolve("scripts/activate-unified-auth-data-access.mjs")], {
        cwd: resolve("."),
        encoding: "utf8",
        env: { ...process.env, AUTH_DATA_CUTOVER_CONFIG: manifest },
      }),
      (error) => error?.code === 1 && error?.stderr?.trim() === "AUTH_DATA_CUTOVER_CONFIG_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
