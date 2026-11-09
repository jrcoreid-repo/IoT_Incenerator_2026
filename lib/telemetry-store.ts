import type { Telemetry, TelemetryResponse } from "./telemetry";
import { isTelemetry } from "./telemetry";

// Redis digunakan di produksi agar data tidak hilang saat serverless restart.
// Tanpa Redis, penyimpanan memori hanya diizinkan saat pengembangan lokal.
const LATEST = "adi:telemetry:latest";
const HISTORY = "adi:telemetry:history";
const LIMIT = 120;
let localHistory: Telemetry[] = [];

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function command(parts: (string | number)[]): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error("Penyimpanan Redis belum dikonfigurasi.");
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Penyimpanan tidak dapat dihubungi.");
  const data = await response.json() as { result?: unknown; error?: string };
  if (data.error) throw new Error("Perintah penyimpanan gagal.");
  return data.result;
}

export function isStorageReady() {
  return Boolean(redisConfig()) || process.env.NODE_ENV !== "production";
}

export async function appendTelemetry(data: Telemetry) {
  if (redisConfig()) {
    await command(["SET", LATEST, JSON.stringify(data)]);
    await command(["LPUSH", HISTORY, JSON.stringify(data)]);
    await command(["LTRIM", HISTORY, 0, LIMIT - 1]);
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Penyimpanan produksi belum dikonfigurasi.");
  localHistory = [...localHistory.slice(-(LIMIT - 1)), data];
}

export async function readTelemetry(): Promise<TelemetryResponse> {
  if (redisConfig()) {
    const items = await command(["LRANGE", HISTORY, 0, LIMIT - 1]);
    const raw = Array.isArray(items) ? items : [];
    const history = raw
      .map((v) => { try { return typeof v === "string" ? JSON.parse(v) as unknown : null; } catch { return null; } })
      .filter(isTelemetry)
      .reverse();
    return { latest: history[history.length - 1] ?? null, history, storageReady: true };
  }
  if (process.env.NODE_ENV === "production") {
    return { latest: null, history: [], storageReady: false };
  }
  return { latest: localHistory[localHistory.length - 1] ?? null, history: [...localHistory], storageReady: true };
}
