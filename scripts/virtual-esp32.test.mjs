import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { STAGES, parseOptions, stageAt, generatePayload } from "./virtual-esp32.mjs";

const sensorKeys = ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"];

test("every fixed scenario generates a valid numeric telemetry payload", () => {
  for (const scenario of STAGES) {
    const { payload, stage } = generatePayload({ scenario, deviceId: "ESP32-VIRTUAL-01" }, 4);
    assert.equal(stage, scenario);
    assert.equal(payload.deviceId, "ESP32-VIRTUAL-01");
    assert.equal(Object.keys(payload).length, 9);
    for (const field of sensorKeys) {
      assert.equal(typeof payload[field], "number", scenario + ":" + field);
      assert.ok(Number.isFinite(payload[field]));
      assert.ok(payload[field] >= 0);
    }
    assert.ok(payload.humidity <= 100);
  }
});

test("scenarios cross configured internal warning and critical thresholds", () => {
  const normal = generatePayload({ scenario: "active" }).payload;
  const warning = generatePayload({ scenario: "warning" }).payload;
  const critical = generatePayload({ scenario: "critical" }).payload;
  assert.ok(normal.furnace > 180);
  assert.ok(normal.co < 50 && normal.voc < 75);
  assert.ok(warning.co >= 50 && warning.voc >= 75);
  assert.ok(critical.co >= 100 && critical.voc >= 150);
});

test("cycle moves through all stages with controlled transitions", () => {
  const at = STAGES.map((_, i) => stageAt(i * 20 + 15, "cycle", 20).name);
  assert.deepEqual(at, STAGES);
  assert.equal(stageAt(20, "cycle", 20).progress, 0);
  assert.equal(stageAt(33, "cycle", 20).progress, 1);
  assert.equal(stageAt(120, "cycle", 20).name, "idle");
});

test("sender rejects unsafe endpoints and invalid parameters", () => {
  assert.throws(() => parseOptions(["--url", "http://example.com/api/telemetry"]), /HTTPS/);
  assert.throws(() => parseOptions(["--url", "https://example.com/other"]), /api\/telemetry/);
  assert.throws(() => parseOptions(["--scenario", "nonexistent"]), /Skenario/);
  assert.throws(() => parseOptions(["--count", "-1"]), /count/);
  assert.throws(() => parseOptions(["--interval", "0"]), /interval/);
  assert.equal(parseOptions(["--scenario", "warning", "--count", "2"]).count, 2);
});

test("dry run exits without token or network requests", () => {
  const script = resolve(fileURLToPath(new URL("./virtual-esp32.mjs", import.meta.url)));
  const result = spawnSync(process.execPath, [script, "--dry-run", "--scenario", "critical"], {
    encoding: "utf8", timeout: 10000, env: { ...process.env, TELEMETRY_INGEST_KEY: "" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Tidak ada data dikirim/);
  assert.match(result.stdout, /"deviceId": "ESP32-VIRTUAL-01"/);
});
