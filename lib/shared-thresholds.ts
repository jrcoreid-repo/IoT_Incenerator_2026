import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./logic-tree";
import { hasRedisStorage, redisCommand } from "./redis-command";

const KEY = "adi:monitoring:thresholds:v1";
const PATH = join(process.cwd(), ".local-data", "thresholds.json");

export function validateThresholds(value: unknown): value is Thresholds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys: (keyof Thresholds)[] = ["activeTemp", "transitionTemp", "coWarning", "vocWarning", "riskWarning"];
  if (Object.keys(obj).length !== keys.length || keys.some(k => typeof obj[k] !== "number" || !Number.isFinite(obj[k]) || (obj[k] as number) < 0)) return false;
  return (obj.activeTemp as number) > 0 && (obj.activeTemp as number) <= 2000 &&
    (obj.transitionTemp as number) < (obj.activeTemp as number) &&
    (obj.coWarning as number) > 0 && (obj.coWarning as number) <= 100000 &&
    (obj.vocWarning as number) > 0 && (obj.vocWarning as number) <= 100000 &&
    (obj.riskWarning as number) <= 100;
}
export async function readThresholds(): Promise<Thresholds> {
  let raw: unknown;
  if (hasRedisStorage()) raw = await redisCommand(["GET", KEY]);
  else {
    if (process.env.NODE_ENV === "production") throw new Error("THRESHOLDS_STORAGE_REQUIRED");
    try { raw = await readFile(PATH, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_THRESHOLDS };
      throw error;
    }
  }
  if (raw === null || raw === undefined) return { ...DEFAULT_THRESHOLDS };
  if (typeof raw !== "string") throw new Error("THRESHOLDS_STORAGE_INVALID");
  const value: unknown = JSON.parse(raw);
  if (!validateThresholds(value)) throw new Error("THRESHOLDS_STORAGE_INVALID");
  return value;
}
export async function saveThresholds(thresholds: Thresholds): Promise<void> {
  if (!validateThresholds(thresholds)) throw new Error("INVALID_THRESHOLDS");
  if (hasRedisStorage()) { await redisCommand(["SET", KEY, JSON.stringify(thresholds)]); return; }
  if (process.env.NODE_ENV === "production") throw new Error("THRESHOLDS_STORAGE_REQUIRED");
  await mkdir(dirname(PATH), { recursive: true, mode: 0o700 });
  const temp = PATH + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(temp, JSON.stringify(thresholds, null, 2), { flag: "wx", mode: 0o600 });
  await rename(temp, PATH);
}
