import { randomUUID } from "node:crypto";

export function createPlatformId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
