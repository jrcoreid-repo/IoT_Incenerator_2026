import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/deploy-preflight.mjs");
const valid = {
  ADMIN_USERNAME: "research-operator",
  ADMIN_PASSWORD: "strong-passphrase-for-staging-123",
  SESSION_SECRET: "a-very-long-unique-session-key-for-integration-test-2026",
  TELEMETRY_INGEST_KEY: "different-esp32-ingest-secret-123456",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "a-private-upstash-redis-token-value"
};

function run(fields, args = []) {
  const folder = mkdtempSync(join(tmpdir(), "adi-deploy-check-"));
  try {
    const path = join(folder, ".env.deploy.local");
    writeFileSync(path, Object.entries(fields).map(([key, value]) => key + "=" + value).join("\n") + "\n");
    const env = { ...process.env };
    for (const key of Object.keys(valid)) delete env[key];
    return spawnSync(process.execPath, [script, "--env-file", path, ...args], {
      encoding: "utf8", env, cwd: resolve(".")
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("accepts complete deployment settings", () => {
  const result = run(valid);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("rejects absent Redis and short secrets without printing private values", () => {
  const result = run({ ...valid, UPSTASH_REDIS_REST_TOKEN: "", SESSION_SECRET: "weak" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UPSTASH_REDIS_REST_TOKEN/);
  assert.match(result.stderr, /SESSION_SECRET/);
  assert.doesNotMatch(result.stdout + result.stderr, /strong-passphrase-for-staging-123/);
});

test("requires HTTPS REST URL for production database", () => {
  const result = run({ ...valid, UPSTASH_REDIS_REST_URL: "http://localhost:8079" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTPS/);
});

test("rejects using same token for login and device ingest", () => {
  const result = run({ ...valid, TELEMETRY_INGEST_KEY: valid.ADMIN_PASSWORD });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /harus berbeda/);
});
