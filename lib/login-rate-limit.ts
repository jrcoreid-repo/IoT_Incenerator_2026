import { createHash } from "node:crypto";

const WINDOW_SECONDS = 15 * 60;
const ACCOUNT_LIMIT = 8;
const IP_LIMIT = 60;

// Atomically count attempts and set expiry on first use; one call per bucket.
// Rate limiting applies to both successful and unsuccessful attempts. On
// successful login the account bucket is reset, while the network bucket stays.
const LUA = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1])) end
local ttl = redis.call("TTL", KEYS[1])
if n > tonumber(ARGV[2]) then return {0, ttl} end
return {1, 0}
`;

type RateResult = { allowed: boolean; retryAfter: number };
type Bucket = { count: number; expires: number };
const localCounters = new Map<string, Bucket>();

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function accountKey(username: string) {
  return "adi:auth:account:" + sha(username.trim().toLowerCase());
}

function networkKey(request: Request) {
  // Vercel replaces client-provided X-Forwarded-For to prevent spoofing.
  // Never trust raw X-Forwarded-For on arbitrary self-hosted installations.
  const vercel = process.env.VERCEL === "1";
  const value = vercel ? request.headers.get("x-vercel-forwarded-for") : null;
  const source = value && value.length < 128 ? value.split(",")[0].trim() : "shared-network";
  return "adi:auth:network:" + sha(source);
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

async function command(parts: (string | number)[]) {
  const cfg = redisConfig();
  if (!cfg) throw new Error("AUTH_REDIS_MISSING");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(parts),
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("AUTH_REDIS_UNAVAILABLE");
    const result = await response.json() as { result?: unknown; error?: string };
    if (result.error) throw new Error("AUTH_REDIS_ERROR");
    return result.result;
  } finally {
    clearTimeout(timer);
  }
}

async function checkBucket(key: string, max: number): Promise<RateResult> {
  if (redisConfig()) {
    const result = await command(["EVAL", LUA, 1, key, WINDOW_SECONDS, max]);
    if (!Array.isArray(result) || result.length !== 2) throw new Error("AUTH_REDIS_INVALID");
    const [allowed, retry] = result.map(Number);
    if (![0, 1].includes(allowed) || !Number.isFinite(retry)) throw new Error("AUTH_REDIS_INVALID");
    return { allowed: allowed === 1, retryAfter: Math.max(1, Math.ceil(retry)) };
  }
  // Local development only: production MUST use durable shared Redis counters.
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_REDIS_REQUIRED");
  const now = Date.now();
  const existing = localCounters.get(key);
  const expires = existing && existing.expires > now ? existing.expires : now + WINDOW_SECONDS * 1000;
  const count = existing && existing.expires > now ? existing.count + 1 : 1;
  localCounters.set(key, { count, expires });
  if (localCounters.size > 10_000) {
    for (const [id, value] of localCounters) {
      if (value.expires <= now) localCounters.delete(id);
    }
  }
  return { allowed: count <= max, retryAfter: count <= max ? 0 : Math.max(1, Math.ceil((expires - now) / 1000)) };
}

export async function consumeLoginAttempt(username: string, request: Request): Promise<RateResult> {
  const a = await checkBucket(accountKey(username), ACCOUNT_LIMIT);
  const b = await checkBucket(networkKey(request), IP_LIMIT);
  return {
    allowed: a.allowed && b.allowed,
    retryAfter: Math.max(a.allowed ? 0 : a.retryAfter, b.allowed ? 0 : b.retryAfter)
  };
}

export async function clearAccountLoginAttempts(username: string) {
  const key = accountKey(username);
  if (redisConfig()) {
    await command(["DEL", key]);
  } else if (process.env.NODE_ENV !== "production") {
    localCounters.delete(key);
  } else throw new Error("AUTH_REDIS_REQUIRED");
}
