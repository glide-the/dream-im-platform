import { createHash } from "node:crypto";

export const SOURCE_TABLES = [
  "users",
  "story_workspace_workspaces",
  "story_workspace_stories",
];

export function parseSafeTargetUrl(rawValue, runtimeDatabaseUrl) {
  if (!rawValue) {
    throw new Error("TEST_DATABASE_URL is required for Story source import.");
  }

  let target;
  try {
    target = new URL(rawValue);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL.");
  }
  if (decodeURIComponent(target.pathname.replace(/^\//, "")) !== "ink-memory") {
    throw new Error("TEST_DATABASE_URL must target the ink-memory database.");
  }
  if ((target.port || "5432") === "5433") {
    throw new Error("Port 5433 is reserved for the shared ink-memory database and is not a valid import target.");
  }

  if (runtimeDatabaseUrl) {
    let runtime;
    try {
      runtime = new URL(runtimeDatabaseUrl);
    } catch {
      throw new Error("DATABASE_URL is invalid; refusing to compare the import target unsafely.");
    }
    const normalize = (url) => `${url.protocol}//${url.hostname}:${url.port || "5432"}${url.pathname}`;
    if (normalize(target) === normalize(runtime)) {
      throw new Error("TEST_DATABASE_URL must not point to the configured runtime DATABASE_URL.");
    }
  }
  return target;
}

export function fingerprintIds(ids) {
  return createHash("sha256")
    .update([...ids].map(String).sort().join("\n"))
    .digest("hex");
}

export function validateSourceRows(source) {
  const users = source.users ?? [];
  const workspaces = source.story_workspace_workspaces ?? [];
  const stories = source.story_workspace_stories ?? [];
  const unique = (rows, key) => new Set(rows.map((row) => String(row[key]))).size === rows.length;

  if (!unique(users, "id") || !unique(users, "email")) {
    throw new Error("Source users contain duplicate IDs or email addresses.");
  }
  if (!unique(workspaces, "id") || !unique(stories, "id") || !unique(stories, "identifier")) {
    throw new Error("Source Story tables contain duplicate IDs or Story identifiers.");
  }

  const userIds = new Set(users.map((row) => String(row.id)));
  const workspaceIds = new Set(workspaces.map((row) => String(row.id)));
  for (const workspace of workspaces) {
    if (!userIds.has(String(workspace.owner_id))) {
      throw new Error(`Source workspace ${workspace.id} has an unknown owner.`);
    }
    try {
      JSON.parse(workspace.settings ?? "{}");
    } catch {
      throw new Error(`Source workspace ${workspace.id} contains invalid settings JSON.`);
    }
  }

  const statuses = new Set(["draft", "published", "archived"]);
  const reviewStatuses = new Set(["pending", "confirmed", "rejected"]);
  const types = new Set(["short", "long", "script", "outline"]);
  for (const story of stories) {
    if (!userIds.has(String(story.author_id)) || !workspaceIds.has(String(story.workspace_id))) {
      throw new Error(`Source Story ${story.id} has an unknown author or workspace.`);
    }
    if (!statuses.has(story.status) || !reviewStatuses.has(story.review_status) || !types.has(story.type)) {
      throw new Error(`Source Story ${story.id} contains an unsupported enum value.`);
    }
    if (story.agent_generated !== 0 && story.agent_generated !== 1) {
      throw new Error(`Source Story ${story.id} has an invalid agent_generated value.`);
    }
  }

  return {
    counts: {
      users: users.length,
      story_workspace_workspaces: workspaces.length,
      story_workspace_stories: stories.length,
    },
    fingerprints: {
      users: fingerprintIds(users.map((row) => row.id)),
      story_workspace_workspaces: fingerprintIds(workspaces.map((row) => row.id)),
      story_workspace_stories: fingerprintIds(stories.map((row) => row.id)),
    },
  };
}

export function safeTargetLabel(url) {
  return `${url.hostname}:${url.port || "5432"}/ink-memory`;
}
