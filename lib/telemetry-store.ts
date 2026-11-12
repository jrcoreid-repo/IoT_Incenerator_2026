import type { Telemetry, TelemetryResponse } from "./telemetry";
import { isTelemetry } from "./telemetry";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { hasRedisStorage, redisCommand } from "./redis-command";

// Live monitoring follows the ESP's 10s transmit cadence.
// The separate research archive is sampled at most once every 10 seconds and
// never exposes or retains readings older than 7 rolling days.
export const LOG_INTERVAL_MS = 10_000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ARCHIVE_ROWS = Math.ceil(RETENTION_MS / LOG_INTERVAL_MS);
const RETENTION_SECONDS = RETENTION_MS / 1000;
const LIVE_HISTORY = "adi:telemetry:history";
const ARCHIVE = "adi:telemetry:archive:v1";
const LAST_ARCHIVED = "adi:telemetry:last-archived-ms:v1";
const LIVE_LIMIT = 120;
const PAGE_SIZE = 1000;

// Lua performs all writes atomically: each incoming reading updates live;
// at most one 10s archive record is added; old archive members are pruned.
// A 7-day key TTL removes the entire archive when the device stops forever.
const INGEST_SCRIPT = `
redis.call('LPUSH', KEYS[1], ARGV[2])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[3]) - 1)
local now = tonumber(ARGV[1])
local last = tonumber(redis.call('GET', KEYS[3]) or '0')
if now - last >= tonumber(ARGV[4]) or now < last then
  redis.call('ZADD', KEYS[2], now, ARGV[2])
  redis.call('SET', KEYS[3], now, 'EX', tonumber(ARGV[5]))
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', '(' .. tostring(now - tonumber(ARGV[6])))
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
  return 1
end
return 0
`;

const LOCAL_FILE = join(process.cwd(), ".local-data", "telemetry-7days.jsonl");
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let liveLocal: Telemetry[] = [];
let archiveLocal: Telemetry[] | null = null;
let lastArchivedLocal = 0;
let lastPruneLocal = 0;
let localSerial: Promise<void> = Promise.resolve();

function decode(value: unknown): Telemetry | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isTelemetry(parsed) ? parsed : null;
  } catch { return null; }
}

function runLocalExclusive<T>(task: () => Promise<T>): Promise<T> {
  // Serialize HTTP writes so local JSONL never interleaves or double samples.
  const next = localSerial.then(task, task);
  localSerial = next.then(() => undefined, () => undefined);
  return next;
}

async function loadLocalArchive(): Promise<Telemetry[]> {
  if (archiveLocal) return archiveLocal;
  if (process.env.NODE_ENV === "production") throw new Error("Redis diperlukan untuk produksi.");
  let raw = "";
  try { raw = await readFile(LOCAL_FILE, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const cutoff = Date.now() - RETENTION_MS;
  archiveLocal = raw.split("\n").map(line => decode(line))
    .filter((item): item is Telemetry => item !== null && Date.parse(item.receivedAt) >= cutoff)
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  lastArchivedLocal = archiveLocal.length ? Date.parse(archiveLocal[archiveLocal.length - 1].receivedAt) : 0;
  // The first new log after a restart also compacts expired rows on disk.
  lastPruneLocal = 0;
  return archiveLocal;
}

async function compactLocalArchive(now: number) {
  if (!archiveLocal) return;
  archiveLocal = archiveLocal.filter(item => Date.parse(item.receivedAt) >= now - RETENTION_MS);
  await mkdir(dirname(LOCAL_FILE), { recursive: true, mode: 0o700 });
  const temp = LOCAL_FILE + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temp, archiveLocal.map(item => JSON.stringify(item)).join("\n") + (archiveLocal.length ? "\n" : ""), {
    flag: "wx", mode: 0o600
  });
  await rename(temp, LOCAL_FILE);
  lastPruneLocal = now;
}

export function isStorageReady() {
  return Boolean(hasRedisStorage()) || process.env.NODE_ENV !== "production";
}

export async function appendTelemetry(data: Telemetry) {
  const now = Date.parse(data.receivedAt);
  if (!Number.isFinite(now)) throw new Error("Timestamp telemetry tidak valid.");
  if (hasRedisStorage()) {
    await redisCommand([
      "EVAL", INGEST_SCRIPT, 3, LIVE_HISTORY, ARCHIVE, LAST_ARCHIVED,
      now, JSON.stringify(data), LIVE_LIMIT, LOG_INTERVAL_MS, RETENTION_SECONDS, RETENTION_MS
    ]);
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Penyimpanan produksi belum dikonfigurasi.");
  await runLocalExclusive(async () => {
    liveLocal = [...liveLocal.slice(-(LIVE_LIMIT - 1)), data];
    const archive = await loadLocalArchive();
    if (now - lastArchivedLocal < LOG_INTERVAL_MS && now >= lastArchivedLocal) return;
    archive.push(data);
    lastArchivedLocal = now;
    await mkdir(dirname(LOCAL_FILE), { recursive: true, mode: 0o700 });
    await appendFile(LOCAL_FILE, JSON.stringify(data) + "\n", { mode: 0o600 });
    if (now - lastPruneLocal >= PRUNE_INTERVAL_MS) await compactLocalArchive(now);
  });
}

export async function readTelemetry(): Promise<TelemetryResponse> {
  if (hasRedisStorage()) {
    const items = await redisCommand(["LRANGE", LIVE_HISTORY, 0, LIVE_LIMIT - 1]);
    const history = (Array.isArray(items) ? items : []).map(decode)
      .filter((item): item is Telemetry => item !== null).reverse();
    return { latest: history[history.length - 1] ?? null, history, storageReady: true };
  }
  if (process.env.NODE_ENV === "production") {
    return { latest: null, history: [], storageReady: false };
  }
  return { latest: liveLocal[liveLocal.length - 1] ?? null, history: [...liveLocal], storageReady: true };
}

// A paged iterator avoids materializing a week of 60,480 rows in server memory.
// Date filtering is enforced here as defense-in-depth, including offline files.
export async function* iterateArchived(fromMs: number, untilMs: number): AsyncGenerator<Telemetry> {
  const min = Math.max(fromMs, Date.now() - RETENTION_MS);
  const max = Math.min(untilMs, Date.now());
  if (min > max) return;
  if (hasRedisStorage()) {
    let cursor = min;
    while (cursor <= max) {
      const result = await redisCommand(["ZRANGEBYSCORE", ARCHIVE, cursor, max, "LIMIT", 0, PAGE_SIZE]);
      if (!Array.isArray(result) || result.length === 0) return;
      let last = cursor - 1;
      for (const raw of result) {
        const item = decode(raw);
        if (!item) continue;
        const time = Date.parse(item.receivedAt);
        if (time >= cursor && time <= max) { yield item; last = Math.max(last, time); }
      }
      if (result.length < PAGE_SIZE || last < cursor) return;
      cursor = last + 1;
    }
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Redis diperlukan untuk produksi.");
  // A single process owns local development writes. Snapshot the data to avoid
  // mutation while iterating across await points.
  const items = await runLocalExclusive(async () => [...await loadLocalArchive()]);
  for (const item of items) {
    const time = Date.parse(item.receivedAt);
    if (time >= min && time <= max) yield item;
  }
}
