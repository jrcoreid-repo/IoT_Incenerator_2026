import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port pengujian tidak tersedia");
  const port = address.port;
  await new Promise((done) => server.close(done));
  return port;
}

async function waitUntilServing(base, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error("Next.js berhenti sebelum tes dimulai.");
    try {
      const response = await fetch(base + "/login", { redirect: "manual", signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return;
    } catch { /* server starting */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("Server Next.js tidak siap untuk pengujian autentikasi.");
}

function assertRedirectTo(response, expectedPath) {
  assert.ok([301, 302, 303, 307, 308].includes(response.status), "Diharapkan redirect, menerima " + response.status);
  assert.equal(new URL(response.headers.get("location")).pathname, expectedPath);
}

test("dashboard requires a signed session; logout and telemetry are private", { timeout: 120000 }, async () => {
  const port = await availablePort();
  const origin = "http://127.0.0.1:" + port;
  const username = "integration-admin";
  const password = "IntegrationAdminStrongPassword2026!";
  const secret = "integration-session-secret-is-very-long-and-randomized-for-tests";
  const token = "integration-telemetry-ingest-token-long-enough";

  // Local Upstash-REST compatible test double. Production login fails closed
  // when Redis is not configured or unavailable; do not bypass this in CI.
  const counters = new Map();
  const redisServer = createHttpServer(async (request, response) => {
    let raw = "";
    for await (const part of request) raw += part;
    let result;
    try {
      const parts = JSON.parse(raw);
      if (parts[0] === "EVAL") {
        const key = parts[3];
        const windowSeconds = Number(parts[4]);
        const maximum = Number(parts[5]);
        const now = Date.now();
        const found = counters.get(key);
        const expiration = found && found.expires > now ? found.expires : now + windowSeconds * 1000;
        const count = found && found.expires > now ? found.count + 1 : 1;
        counters.set(key, { count, expires: expiration });
        result = [Number(count <= maximum), count <= maximum ? 0 : Math.ceil((expiration - now) / 1000)];
      } else if (parts[0] === "DEL") {
        result = Number(counters.delete(parts[1]));
      } else if (parts[0] === "LRANGE") {
        result = [];
      } else {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Unsupported Redis command" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ result }));
    } catch {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid Redis command" }));
    }
  });
  await new Promise((resolve, reject) => {
    redisServer.once("error", reject);
    redisServer.listen(0, "127.0.0.1", resolve);
  });
  const redisPort = redisServer.address().port;
  const child = spawn(process.execPath, [
    resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"
  ], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      SESSION_SECRET: secret,
      TELEMETRY_INGEST_KEY: token,
      UPSTASH_REDIS_REST_URL: "http://127.0.0.1:" + redisPort,
      UPSTASH_REDIS_REST_TOKEN: "integration-redis-token"
    }
  });

  const request = (path, options = {}) => fetch(origin + path, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
    ...options
  });

  try {
    await waitUntilServing(origin, child);
    const root = await request("/");
    assertRedirectTo(root, "/login");

    const admin = await request("/admin");
    assertRedirectTo(admin, "/login");
    assert.match(admin.headers.get("cache-control") ?? "", /no-store/i);

    const publicTelemetry = await request("/api/telemetry");
    assert.equal(publicTelemetry.status, 401);
    assert.match(publicTelemetry.headers.get("cache-control") ?? "", /no-store/i);

    const loginPage = await request("/login");
    assert.equal(loginPage.status, 200);
    const loginHtml = await loginPage.text();
    assert.match(loginHtml, /name="format-detection"[^>]*telephone=no[^>]*date=no[^>]*email=no[^>]*address=no/);


    const crossSite = await request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://untrusted.example" },
      body: JSON.stringify({ username, password })
    });
    assert.equal(crossSite.status, 403);
    const wrongLogout = await request("/api/logout", {
      method: "POST", headers: { origin: "https://untrusted.example" }
    });
    assert.equal(wrongLogout.status, 403);

    const wrong = await request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "incorrect-password" })
    });
    assert.equal(wrong.status, 401);

    const login = await request("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /jr_admin=/);
    assert.match(setCookie, /httponly/i);
    assert.match(setCookie, /samesite=strict/i);
    const cookie = setCookie.split(";")[0];
    assert.ok(cookie.length > 20);

    assertRedirectTo(await request("/", { headers: { cookie } }), "/admin");
    assertRedirectTo(await request("/login", { headers: { cookie } }), "/admin");

    const privateAdmin = await request("/admin", { headers: { cookie } });
    assert.equal(privateAdmin.status, 200);
    assert.match(privateAdmin.headers.get("cache-control") ?? "", /no-store/i);
    const adminHtml = await privateAdmin.text();
    assert.match(adminHtml, /name="format-detection"[^>]*telephone=no[^>]*date=no[^>]*email=no[^>]*address=no/);

    const privateTelemetry = await request("/api/telemetry", { headers: { cookie } });
    assert.equal(privateTelemetry.status, 200);

    const [tokenPayload, tokenSignature] = cookie.slice("jr_admin=".length).split(".");
    const malformed = "jr_admin=" + tokenPayload + "." + (tokenSignature[0] === "A" ? "B" : "A") + tokenSignature.slice(1);
    assertRedirectTo(await request("/admin", { headers: { cookie: malformed } }), "/login");
    assert.equal((await request("/api/telemetry", { headers: { cookie: malformed } })).status, 401);

    const postWithoutDeviceToken = await request("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: "ESP32-VIRTUAL-01", furnace: 150 })
    });
    assert.equal(postWithoutDeviceToken.status, 401);

    const logout = await request("/api/logout", { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /jr_admin=;/);
    assertRedirectTo(await request("/admin"), "/login");
    assert.equal((await request("/api/telemetry")).status, 401);

    // A single account cannot be brute-forced indefinitely; lockout is shared
    // across instances through the Redis rate-limit backend.
    for (let i = 0; i < 8; i++) {
      const attempt = await request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "bad-secret" })
      });
      assert.equal(attempt.status, 401);
    }
    const blocked = await request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  } finally {
    child.kill("SIGTERM");
    await new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once("exit", done);
      setTimeout(done, 5000).unref();
    });
    await new Promise((done) => redisServer.close(done));
  }
});
