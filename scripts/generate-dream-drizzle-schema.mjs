// [Input] Isolated Dream PostgreSQL introspection output.
// [Output] Non-baseline Dream Drizzle declarations for @ink-memory/db schema ownership.
// [Pos] Auditable schema-generation helper; never runs at application startup.
// [Sync] 2026-08-21: target the package-local canonical schema import.
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") {
  throw new Error(
    "Usage: node scripts/generate-dream-drizzle-schema.mjs --input <introspected-schema.ts> --output <dream.ts>",
  );
}

const source = await readFile(args[1], "utf8");
const baselineNames = new Set([
  "users",
  "story_workspace_workspaces",
  "story_workspace_stories",
]);
const declaration = /^export const ([a-zA-Z0-9_]+) = pgTable\(/gm;
const matches = [...source.matchAll(declaration)];
if (matches.length !== 48) {
  throw new Error(`Expected 48 introspected Dream tables, found ${matches.length}`);
}

const removeRanges = [];
for (const match of matches) {
  if (!baselineNames.has(match[1])) continue;
  const end = source.indexOf("\n]);", match.index);
  if (end < 0) throw new Error(`Could not find end of ${match[1]} declaration`);
  removeRanges.push([match.index, end + "\n]);".length]);
}
if (removeRanges.length !== baselineNames.size) {
  throw new Error("Introspected schema is missing a canonical baseline table");
}

let body = source;
for (const [start, end] of removeRanges.sort((left, right) => right[0] - left[0])) {
  body = body.slice(0, start) + body.slice(end);
}
const importEnd = body.indexOf("\n", body.indexOf("\n") + 1) + 1;
body = `${body.slice(0, importEnd)}\nimport {\n  storyWorkspaceStories as story_workspace_stories,\n  storyWorkspaceWorkspaces as story_workspace_workspaces,\n  users,\n} from "./index.js";\n${body.slice(importEnd)}`;
body = body.replace(
  /\.generatedByDefaultAsIdentity\(\{ name: "[a-z0-9_]+", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 \}\)/g,
  ".generatedByDefaultAsIdentity()",
);
body = body.replace(/\n{4,}/g, "\n\n").trim();

const generated = `// Generated from an isolated PostgreSQL 16 replay of Admin 0000-0031\n// plus the approved Dream 20260811_07 physical catalog. Do not edit manually.\n${body}\n`;
const remaining = [...generated.matchAll(declaration)].map((match) => match[1]);
if (remaining.length !== 45 || remaining.some((name) => baselineNames.has(name))) {
  throw new Error("Generated Dream schema does not contain exactly 45 non-baseline tables");
}
await writeFile(args[3], generated, { flag: "wx" });
console.log(JSON.stringify({ output: args[3], tables: remaining.length }));
