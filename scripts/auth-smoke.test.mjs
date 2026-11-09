import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { once } from "node:events";

async function availablePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port unavailable");
  await new Promise(done => server.close(done));
  return address.port;
}
async function waitForReady(origin, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Next.js stopped before tests");
    try {
      const r = await fetch(origin + "/login", { redirect: "manual", signal: AbortSignal.timeout(3000) });
      if (r.status === 200) return;
    } catch { /* Server startup */ }
    await new Promise(resolve => setTimeout(resolve, 220));
  }
  throw new Error("Next.js was not ready");
}
function redirectTo(response, path) {
  assert.ok([301, 302, 303, 307, 308].includes(response.status), "Expected redirect, got HTTP " + response.status);
  assert.equal(new URL(response.headers.get("location")).pathname, path);
}
function findCookie(response) {
  const header = response.headers.get("set-cookie") ?? "";
  assert.match(header, /jr_admin=/);
  assert.match(header, /httponly/i);
  assert.match(header, /samesite=strict/i);
  return header.split(";")[0];
}

test("role-based admin/operator flow, persistent account actions, shared limits and auth protections", { timeout: 150000 }, async () => {
  const port = await availablePort();
  const origin = "http://127.0.0.1:" + port;
  const adminName = "integration-admin";
  const adminPassword = "IntegrationAdminStrongPassword2026!";
  const operatorName = "operator-testing";
  const operatorPassword = "NewOperatorPassphrase2026!";
  const operatorNewPassword = "OperatorResetPassphrase2026!";
  const secret = "integration-session-secret-is-very-long-and-randomized-for-tests";
  const ingestKey = "integration-telemetry-ingest-token-long-enough";

  // Mock the small subset of Upstash REST commands used by this integration.
  const counters = new Map();
  const strings = new Map();
  const hashes = new Map();
  const redisServer = createHttpServer(async (request, response) => {
    let raw = "";
    for await (const part of request) raw += part;
    try {
      const parts = JSON.parse(raw);
      const cmd = parts[0];
      let result = null;
      if (cmd === "EVAL") {
        const key = parts[3];
        const seconds = Number(parts[4]);
        const max = Number(parts[5]);
        const now = Date.now();
        const previous = counters.get(key);
        const expires = previous && previous.expires > now ? previous.expires : now + seconds * 1000;
        const count = previous && previous.expires > now ? previous.count + 1 : 1;
        counters.set(key, { count, expires });
        result = [Number(count <= max), count <= max ? 0 : Math.ceil((expires - now) / 1000)];
      } else if (cmd === "DEL") {
        result = Number(counters.delete(parts[1]) || strings.delete(parts[1]));
      } else if (cmd === "LRANGE") {
        result = [];
      } else if (cmd === "GET") {
        result = strings.get(parts[1]) ?? null;
      } else if (cmd === "SET") {
        strings.set(parts[1], parts[2]);
        result = "OK";
      } else if (cmd === "HGET") {
        result = hashes.get(parts[1])?.get(parts[2]) ?? null;
      } else if (cmd === "HSETNX") {
        const bucket = hashes.get(parts[1]) ?? new Map();
        hashes.set(parts[1], bucket);
        if (!bucket.has(parts[2])) { bucket.set(parts[2], parts[3]); result = 1; }
        else result = 0;
      } else if (cmd === "HSET") {
        const bucket = hashes.get(parts[1]) ?? new Map();
        hashes.set(parts[1], bucket);
        result = Number(!bucket.has(parts[2]));
        bucket.set(parts[2], parts[3]);
      } else if (cmd === "HGETALL") {
        result = Array.from(hashes.get(parts[1])?.entries() ?? []).flat();
      } else if (cmd === "HLEN") {
        result = hashes.get(parts[1])?.size ?? 0;
      } else {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Unsupported mock Redis command: " + cmd }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ result }));
    } catch {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid mock request" }));
    }
  });
  await new Promise((done, reject) => {
    redisServer.once("error", reject);
    redisServer.listen(0, "127.0.0.1", done);
  });
  const redisPort = redisServer.address().port;
  const child = spawn(process.execPath, [
    resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"
  ], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      ADMIN_USERNAME: adminName,
      ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: secret,
      TELEMETRY_INGEST_KEY: ingestKey,
      UPSTASH_REDIS_REST_URL: "http://127.0.0.1:" + redisPort,
      UPSTASH_REDIS_REST_TOKEN: "integration-redis-secret"
    }
  });

  const request = (path, options = {}) => fetch(origin + path, {
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(9000),
    ...options
  });
  const jsonRequest = (path, method, body, cookie = "") => request(path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  try {
    await waitForReady(origin, child);

    redirectTo(await request("/"), "/login");
    redirectTo(await request("/admin"), "/login");
    redirectTo(await request("/dashboard"), "/login");
    assert.equal((await request("/api/telemetry")).status, 401);
    assert.equal((await request("/api/users")).status, 403);
    assert.equal((await request("/api/thresholds")).status, 401);
    assert.equal((await jsonRequest("/api/users", "POST", { username: "intruder", password: "NoAccess123456!" })).status, 403);

    const loginPage = await request("/login");
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /name="format-detection"[^>]*telephone=no[^>]*date=no/);

    assert.equal((await jsonRequest("/api/login", "POST", { username: adminName, password: "wrong" })).status, 401);
    assert.equal((await jsonRequest("/api/login", "POST", { username: adminName, password: adminPassword }, "")).status, 200);
    const adminLogin = await jsonRequest("/api/login", "POST", { username: adminName, password: adminPassword });
    assert.equal(adminLogin.status, 200);
    const adminBody = await adminLogin.json();
    assert.equal(adminBody.role, "admin");
    assert.equal(adminBody.redirectTo, "/admin");
    const adminCookie = findCookie(adminLogin);
    redirectTo(await request("/", { headers: { cookie: adminCookie } }), "/admin");
    redirectTo(await request("/login", { headers: { cookie: adminCookie } }), "/admin");
    redirectTo(await request("/dashboard", { headers: { cookie: adminCookie } }), "/admin");
    assert.equal((await request("/admin", { headers: { cookie: adminCookie } })).status, 200);
    assert.equal((await request("/api/telemetry", { headers: { cookie: adminCookie } })).status, 200);

    const badOrigin = await request("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://attacker.example", cookie: adminCookie },
      body: JSON.stringify({ username: "attacker", password: "NoAccess123456!" })
    });
    assert.equal(badOrigin.status, 403);
    assert.equal((await request("/api/users", { headers: { cookie: adminCookie } })).status, 200);

    const created = await jsonRequest("/api/users", "POST", { username: operatorName, password: operatorPassword }, adminCookie);
    assert.equal(created.status, 201, await created.text());
    assert.equal((await jsonRequest("/api/users", "POST", { username: operatorName, password: operatorPassword }, adminCookie)).status, 409);
    const list = await (await request("/api/users", { headers: { cookie: adminCookie } })).json();
    assert.equal(list.users.length, 1);
    assert.equal(list.users[0].role, "operator");
    assert.equal(list.users[0].active, true);
    assert.equal(JSON.stringify(list).includes(operatorPassword), false);
    assert.equal(JSON.stringify(list).includes("passwordHash"), false);

    const operatorLogin = await jsonRequest("/api/login", "POST", { username: operatorName, password: operatorPassword });
    assert.equal(operatorLogin.status, 200, await operatorLogin.clone().text());
    const operatorBody = await operatorLogin.clone().json().catch(() => null);
    assert.equal(operatorBody?.redirectTo, "/dashboard");
    const operatorCookie = findCookie(operatorLogin);
    redirectTo(await request("/", { headers: { cookie: operatorCookie } }), "/dashboard");
    redirectTo(await request("/admin", { headers: { cookie: operatorCookie } }), "/dashboard");
    assert.equal((await request("/dashboard", { headers: { cookie: operatorCookie } })).status, 200);
    assert.equal((await request("/api/telemetry", { headers: { cookie: operatorCookie } })).status, 200);
    assert.equal((await request("/api/users", { headers: { cookie: operatorCookie } })).status, 403);
    assert.equal((await jsonRequest("/api/users", "POST", { username: "backdoor", password: "NoAccess123456!" }, operatorCookie)).status, 403);

    const defaults = await (await request("/api/thresholds", { headers: { cookie: operatorCookie } })).json();
    assert.equal(defaults.thresholds.activeTemp, 180);
    const edited = { ...defaults.thresholds, activeTemp: 210, transitionTemp: 110 };
    assert.equal((await jsonRequest("/api/thresholds", "PUT", edited, operatorCookie)).status, 403);
    assert.equal((await jsonRequest("/api/thresholds", "PUT", edited, adminCookie)).status, 200);
    const shared = await (await request("/api/thresholds", { headers: { cookie: operatorCookie } })).json();
    assert.equal(shared.thresholds.activeTemp, 210);

    const reset = await jsonRequest("/api/users/" + operatorName, "PATCH", { action: "reset-password", password: operatorNewPassword }, adminCookie);
    assert.equal(reset.status, 200);
    assert.equal((await request("/api/telemetry", { headers: { cookie: operatorCookie } })).status, 401);
    const revokedPage = await request("/dashboard", { headers: { cookie: operatorCookie } });
    if ([301, 302, 303, 307, 308].includes(revokedPage.status)) {
      redirectTo(revokedPage, "/login");
    } else {
      // Next.js App Router may return HTTP 200 with an RSC redirect in its HTML
      // after the initial response has already started streaming.
      assert.equal(revokedPage.status, 200);
      const html = await revokedPage.text();
      assert.match(html, /NEXT_REDIRECT|__next-page-redirect|url=\\?\/login/i);
      assert.doesNotMatch(html, /Manajemen Pengguna|Khusus pengelola/);
    }
    assert.equal((await jsonRequest("/api/login", "POST", { username: operatorName, password: operatorPassword })).status, 401);
    const newLogin = await jsonRequest("/api/login", "POST", { username: operatorName, password: operatorNewPassword });
    assert.equal(newLogin.status, 200);
    const newCookie = findCookie(newLogin);
    assert.equal((await request("/api/telemetry", { headers: { cookie: newCookie } })).status, 200);

    const disable = await jsonRequest("/api/users/" + operatorName, "PATCH", { action: "disable" }, adminCookie);
    assert.equal(disable.status, 200);
    assert.equal((await request("/api/telemetry", { headers: { cookie: newCookie } })).status, 401);
    assert.equal((await jsonRequest("/api/login", "POST", { username: operatorName, password: operatorNewPassword })).status, 401);
    const enable = await jsonRequest("/api/users/" + operatorName, "PATCH", { action: "enable" }, adminCookie);
    assert.equal(enable.status, 200);
    const enabledLogin = await jsonRequest("/api/login", "POST", { username: operatorName, password: operatorNewPassword });
    assert.equal(enabledLogin.status, 200);

    const [payload, signature] = adminCookie.slice("jr_admin=".length).split(".");
    const malformed = "jr_admin=" + payload + "." + (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    redirectTo(await request("/admin", { headers: { cookie: malformed } }), "/login");
    assert.equal((await request("/api/telemetry", { headers: { cookie: malformed } })).status, 401);
    const expiredOperatorPayload = Buffer.from(payload, "base64url").toString("utf8");
    const claim = JSON.parse(expiredOperatorPayload);
    const signedOperatorPayload = Buffer.from(JSON.stringify({ ...claim, role: "operator", sv: 1 })).toString("base64url");
    const forgedSignature = createHmac("sha256", secret).update(signedOperatorPayload).digest("base64url");
    const forgedOperatorCookie = "jr_admin=" + signedOperatorPayload + "." + forgedSignature;
    redirectTo(await request("/admin", { headers: { cookie: forgedOperatorCookie } }), "/dashboard");
    assert.equal((await request("/api/users", { headers: { cookie: forgedOperatorCookie } })).status, 403);

    assert.equal((await jsonRequest("/api/telemetry", "POST", { deviceId: "TEST", furnace: 80 })).status, 401);
    assert.equal((await request("/api/logout", { method: "POST", headers: { origin: "https://attacker.example", cookie: adminCookie } })).status, 403);
    const logout = await request("/api/logout", { method: "POST", headers: { cookie: adminCookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /jr_admin=;/);

    for (let i = 0; i < 8; i++) {
      const response = await jsonRequest("/api/login", "POST", { username: adminName, password: "bad-password" });
      assert.equal(response.status, 401);
    }
    const blocked = await jsonRequest("/api/login", "POST", { username: adminName, password: adminPassword });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  } finally {
    child.kill("SIGTERM");
    await new Promise(done => {
      if (child.exitCode !== null) return done();
      child.once("exit", done);
      setTimeout(done, 5000).unref();
    });
    await new Promise(done => redisServer.close(done));
  }
});
