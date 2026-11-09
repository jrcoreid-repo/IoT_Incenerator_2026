import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
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
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: ""
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
  } finally {
    child.kill("SIGTERM");
    await new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once("exit", done);
      setTimeout(done, 5000).unref();
    });
  }
});
