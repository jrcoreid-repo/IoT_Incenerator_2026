#!/usr/bin/env node
// Explicit, isolated smoke test against Redis running on the *same* machine.
// Uses a temporary key. Never FLUSHDB, never touches application account/data keys.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "redis";

const address = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
const url = new URL(address);
if (url.protocol !== "redis:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    !/^\/(?:[0-9]+)?$/.test(url.pathname)) {
  throw new Error("Test Redis hanya boleh memakai loopback pada server lokal.");
}

const client = createClient({
  url: address,
  socket: { connectTimeout: 4000, reconnectStrategy: false },
  disableOfflineQueue: true
});
client.on("error", () => {});
const key = "adi:smoke:" + randomBytes(12).toString("hex");
try {
  await client.connect();
  const command = (...parts) => client.sendCommand(parts.map(String));
  assert.equal(await command("PING"), "PONG");
  assert.equal(await command("HSET", key, "a", "1", "b", "2"), 2);
  const rawHash = await command("HGETALL", key);
  // The app's operator-store expects an alternating flat field-value array.
  assert.ok(Array.isArray(rawHash), "Raw HGETALL must be an array (RESP2)");
  assert.deepEqual(Object.fromEntries(
    Array.from({ length: rawHash.length / 2 }, (_, i) => [rawHash[i * 2], rawHash[i * 2 + 1]])
  ), { a: "1", b: "2" });
  assert.equal(await command("EVAL", "return redis.call('HLEN', KEYS[1])", 1, key), 2);
  await command("ZADD", key + ":archive", Date.now(), '{"sample":1}');
  const archive = await command("ZRANGEBYSCORE", key + ":archive", 0, Date.now() + 1000, "LIMIT", 0, 10);
  assert.deepEqual(archive, ['{"sample":1}']);
  console.log("PASS: Redis loopback / PING / HGETALL RESP2 / EVAL / ZRANGEBYSCORE");
} finally {
  if (client.isReady) {
    await client.sendCommand(["DEL", key, key + ":archive"]).catch(() => {});
    await client.quit();
  } else if (client.isOpen) client.destroy();
}
