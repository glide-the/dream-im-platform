export function pickString(input: unknown, keys: string[]): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export function pickStringArray(input: unknown, keys: string[]): string[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return value;
    }
  }
  return [];
}

export function isMcpTool(toolName?: string): boolean {
  return typeof toolName === "string" && /^mcp__.+__.+/.test(toolName);
}
