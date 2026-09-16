// [Input] An absolute Git worktree directory, one expected commit and an Admin/Dream error-code prefix.
// [Output] The verified exact Git HEAD for a tracked-clean release worktree.
// [Pos] Fail-closed source binding shared by the explicit unified auth/data cutover runner.
// [Sync] 2026-09-16: bind normal cutover to exact clean Admin and Dream release worktrees.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commitPattern = /^[0-9a-f]{40}$/;
const allowedPrefixes = new Set([
  "AUTH_DATA_ADMIN_RELEASE",
  "AUTH_DATA_DREAM_RELEASE",
]);

function fail(code) {
  throw new Error(code);
}

async function git(directory, args, code) {
  try {
    const result = await execFileAsync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 5_000,
    });
    return result.stdout.trim();
  } catch {
    fail(code);
  }
}

export async function verifyGitReleaseBinding({ directory, expectedCommit, codePrefix }) {
  if (!allowedPrefixes.has(codePrefix)) fail("AUTH_DATA_RELEASE_BINDING_INVALID");
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    fail(`${codePrefix}_DIRECTORY_REQUIRED`);
  }
  if (typeof expectedCommit !== "string" || !commitPattern.test(expectedCommit)) {
    fail(`${codePrefix}_COMMIT_INVALID`);
  }
  let resolved;
  try {
    resolved = await realpath(directory);
  } catch {
    fail(`${codePrefix}_DIRECTORY_REQUIRED`);
  }
  const head = await git(
    resolved,
    ["rev-parse", "--verify", "HEAD"],
    `${codePrefix}_COMMIT_UNAVAILABLE`,
  );
  if (!commitPattern.test(head)) fail(`${codePrefix}_COMMIT_UNAVAILABLE`);
  if (head !== expectedCommit) fail(`${codePrefix}_COMMIT_MISMATCH`);
  const trackedStatus = await git(
    resolved,
    ["status", "--porcelain=v1", "--untracked-files=no"],
    `${codePrefix}_STATUS_UNAVAILABLE`,
  );
  if (trackedStatus) fail(`${codePrefix}_WORKTREE_DIRTY`);
  return { directory: resolved, head };
}
