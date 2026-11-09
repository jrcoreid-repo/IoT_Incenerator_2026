import "server-only";
import { createClient } from "redis";

// One Redis command layer for a single VPS (TCP loopback) or hosted Upstash REST.
// Keep the existing raw RESP command/reply shapes used by the stores and tests.
type CommandPart = string | number;
type LocalClient = ReturnType<typeof createClient>;

let localClientPromise: Promise<LocalClient> | null = null;
let localConnectionUrl: string | null = null;

function localUrl(): string | null {
  const value = process.env.REDIS_URL?.trim();
  if (!value) return null;
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("REDIS_URL_INVALID"); }
  // Redis is deliberately bound to loopback: never allow internet-facing TCP Redis.
  if (parsed.protocol !== "redis:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      !/^\/(?:[0-9]+)?$/.test(parsed.pathname)) {
    throw new Error("REDIS_URL_MUST_BE_LOCAL_LOOPBACK");
  }
  return parsed.toString();
}

function restConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function hasRedisStorage(): boolean {
  return Boolean(process.env.REDIS_URL?.trim() || restConfig());
}

async function localClient(url: string): Promise<LocalClient> {
  if (localClientPromise && localConnectionUrl !== url) {
    throw new Error("REDIS_URL_CHANGED_AFTER_CONNECT");
  }
  if (!localClientPromise) {
    localConnectionUrl = url;
    const client = createClient({
      url,
      socket: { connectTimeout: 4000, reconnectStrategy: false },
      disableOfflineQueue: true
    });
    // Node Redis requires an error listener. Never log secrets or telemetry here.
    client.on("error", () => {});
    localClientPromise = client.connect().then(() => client).catch(error => {
      localClientPromise = null;
      localConnectionUrl = null;
      throw error;
    });
  }
  const client = await localClientPromise;
  if (!client.isReady) {
    localClientPromise = null;
    localConnectionUrl = null;
    client.destroy();
    return localClient(url);
  }
  return client;
}

export async function redisCommand(parts: CommandPart[]): Promise<unknown> {
  const local = localUrl();
  if (local) {
    const client = await localClient(local);
    // sendCommand preserves the raw Redis replies (including flat HGETALL
    // field/value pairs) relied on by the earlier Upstash REST implementation.
    return client.sendCommand(parts.map(String));
  }

  const cfg = restConfig();
  if (!cfg) throw new Error("REDIS_STORAGE_MISSING");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(parts),
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("REDIS_REST_UNAVAILABLE");
    const result = await response.json() as { result?: unknown; error?: string };
    if (result.error) throw new Error("REDIS_REST_COMMAND_ERROR");
    return result.result;
  } finally {
    clearTimeout(timer);
  }
}
