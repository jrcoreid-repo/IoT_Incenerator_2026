import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hasRedisStorage, redisCommand } from "./redis-command";

export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,31}$/;
export const MAX_OPERATORS = 100;
const scrypt = promisify(scryptCallback);
const REDIS_USERS_KEY = "adi:auth:operators:v1";
const LOCAL_PATH = join(process.cwd(), ".local-data", "operator-users.json");

export type OperatorRecord = {
  username: string;
  role: "operator";
  salt: string;
  passwordHash: string;
  active: boolean;
  sessionVersion: number;
  createdAt: string;
  updatedAt: string;
};
export type OperatorView = Pick<OperatorRecord, "username" | "role" | "active" | "createdAt" | "updatedAt">;

type LocalDatabase = Record<string, OperatorRecord>;
let queue: Promise<void> = Promise.resolve();

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
export function validPassword(password: string) {
  return password.length >= 12 && password.length <= 128 &&
    !/^(?:password|123456|admin)/i.test(password);
}
async function localRead(): Promise<LocalDatabase> {
  if (process.env.NODE_ENV === "production") throw new Error("USER_STORAGE_REDIS_REQUIRED");
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid local user data");
    return data as LocalDatabase;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
async function localWrite(data: LocalDatabase) {
  await mkdir(dirname(LOCAL_PATH), { recursive: true, mode: 0o700 });
  const name = LOCAL_PATH + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(name, JSON.stringify(data, null, 2), { mode: 0o600, flag: "wx" });
  await rename(name, LOCAL_PATH);
}
function serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(() => undefined, () => undefined);
  return next;
}
export async function passwordDigest(password: string, salt: string) {
  const buffer = (await scrypt(password, Buffer.from(salt, "hex"), 64)) as Buffer;
  return buffer.toString("hex");
}
export async function verifyPassword(password: string, user: OperatorRecord) {
  if (typeof user.passwordHash !== "string" || !/^[0-9a-f]{128}$/.test(user.passwordHash) ||
      typeof user.salt !== "string" || !/^[0-9a-f]{32}$/.test(user.salt)) return false;
  const provided = Buffer.from(await passwordDigest(password, user.salt), "hex");
  return timingSafeEqual(Buffer.from(user.passwordHash, "hex"), provided);
}
export function toView(record: OperatorRecord): OperatorView {
  return { username: record.username, role: "operator", active: record.active, createdAt: record.createdAt, updatedAt: record.updatedAt };
}
function parseRecord(raw: unknown): OperatorRecord | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as OperatorRecord;
    return value.role === "operator" && USERNAME_PATTERN.test(value.username) &&
      typeof value.active === "boolean" && Number.isSafeInteger(value.sessionVersion) &&
      value.sessionVersion >= 1 && typeof value.passwordHash === "string" &&
      typeof value.salt === "string" ? value : null;
  } catch { return null; }
}
export async function getOperator(username: string): Promise<OperatorRecord | null> {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) return null;
  if (hasRedisStorage()) return parseRecord(await redisCommand(["HGET", REDIS_USERS_KEY, normalized]));
  const local = await localRead();
  return local[normalized] ?? null;
}
export async function listOperators(): Promise<OperatorView[]> {
  if (hasRedisStorage()) {
    const raw = await redisCommand(["HGETALL", REDIS_USERS_KEY]);
    if (!Array.isArray(raw)) throw new Error("USER_STORAGE_INVALID");
    const users: OperatorView[] = [];
    for (let i = 1; i < raw.length; i += 2) {
      const user = parseRecord(raw[i]);
      if (user) users.push(toView(user));
    }
    return users.sort((a, b) => a.username.localeCompare(b.username));
  }
  const data = await localRead();
  return Object.values(data).map(toView).sort((a, b) => a.username.localeCompare(b.username));
}
export async function createOperator(username: string, password: string): Promise<"created" | "exists" | "full"> {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized) || !validPassword(password)) throw new Error("INVALID_USER_INPUT");
  const salt = randomBytes(16).toString("hex");
  const record: OperatorRecord = {
    username: normalized, role: "operator", salt,
    passwordHash: await passwordDigest(password, salt),
    active: true, sessionVersion: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  if (hasRedisStorage()) {
    // HSETNX atomically prevents duplicate usernames across serverless instances.
    const count = await redisCommand(["HLEN", REDIS_USERS_KEY]);
    if (typeof count !== "number") throw new Error("USER_STORAGE_INVALID");
    if (count >= MAX_OPERATORS) return "full";
    const created = await redisCommand(["HSETNX", REDIS_USERS_KEY, normalized, JSON.stringify(record)]);
    return created === 1 ? "created" : "exists";
  }
  return serializeMutation(async () => {
    const data = await localRead();
    if (data[normalized]) return "exists";
    if (Object.keys(data).length >= MAX_OPERATORS) return "full";
    data[normalized] = record;
    await localWrite(data);
    return "created";
  });
}
export async function updateOperator(username: string, action: "enable" | "disable" | "reset-password", password?: string): Promise<OperatorRecord | null> {
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) return null;
  if (action === "reset-password" && (!password || !validPassword(password))) throw new Error("INVALID_USER_INPUT");
  const update = async (record: OperatorRecord) => {
    const next: OperatorRecord = { ...record, updatedAt: new Date().toISOString(), sessionVersion: record.sessionVersion + 1 };
    if (action === "enable") next.active = true;
    else if (action === "disable") next.active = false;
    else if (password) {
      next.salt = randomBytes(16).toString("hex");
      next.passwordHash = await passwordDigest(password, next.salt);
    }
    return next;
  };
  if (hasRedisStorage()) {
    // Optimistic HSET update is acceptable for a single admin; operator tokens
    // are revalidated on each private request using sessionVersion.
    const existing = await getOperator(normalized);
    if (!existing) return null;
    const next = await update(existing);
    await redisCommand(["HSET", REDIS_USERS_KEY, normalized, JSON.stringify(next)]);
    return next;
  }
  return serializeMutation(async () => {
    const data = await localRead();
    if (!data[normalized]) return null;
    const next = await update(data[normalized]);
    data[normalized] = next;
    await localWrite(data);
    return next;
  });
}
