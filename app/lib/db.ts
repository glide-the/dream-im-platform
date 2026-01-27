import { promises as fs } from "fs";
import path from "path";
import { DbShape } from "./types";
import { seedData } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

type DbQueue = Promise<void>;

type GlobalQueue = typeof globalThis & { __ai4sales_write_queue__?: DbQueue };

async function ensureDbFile() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const initial = seedData();
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf-8");
  }
}

export async function readDb(): Promise<DbShape> {
  await ensureDbFile();
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  return JSON.parse(raw) as DbShape;
}

async function writeDb(db: DbShape) {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
}

export async function withDb<T>(
  mutator: (db: DbShape) => Promise<{ db: DbShape; result: T }> | {
    db: DbShape;
    result: T;
  }
) {
  const globalQueue = globalThis as GlobalQueue;
  if (!globalQueue.__ai4sales_write_queue__) {
    globalQueue.__ai4sales_write_queue__ = Promise.resolve();
  }
  let result: T | undefined;

  globalQueue.__ai4sales_write_queue__ = globalQueue.__ai4sales_write_queue__
    .then(async () => {
      const db = await readDb();
      const outcome = await mutator(db);
      await writeDb(outcome.db);
      result = outcome.result;
    })
    .catch((error) => {
      console.error("DB write failed", error);
      throw error;
    });

  await globalQueue.__ai4sales_write_queue__;
  return result as T;
}
