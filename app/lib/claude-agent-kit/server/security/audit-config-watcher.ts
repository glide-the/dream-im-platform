import fs from "node:fs";
import { parseSecurityAuditConfig } from "./config-schema";
import type { SecurityAuditConfig } from "./types";

export type AuditConfigUpdateHandler = (config: SecurityAuditConfig) => void;

export function watchSecurityAuditConfig(
  configPath: string,
  onUpdate: AuditConfigUpdateHandler
): () => void {
  let closed = false;

  const loadConfig = () => {
    if (closed) {
      return;
    }
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = parseSecurityAuditConfig(JSON.parse(raw));
      onUpdate(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Failed to reload security audit config", message);
    }
  };

  const watcher = fs.watch(configPath, { persistent: false }, () => {
    loadConfig();
  });

  loadConfig();

  return () => {
    closed = true;
    watcher.close();
  };
}
