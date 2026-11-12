import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { STAGES, SENSOR_STATES, parseOptions, stageAt, generatePayload } from "./virtual-esp32.mjs";

const sensorKeys = ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"];

test("every fixed scenario generates a valid numeric telemetry payload", () => {
  for (const scenario of STAGES) {
    const { payload, stage } = generatePayload({ scenario, deviceId: "ESP32-VIRTUAL-01" }, 4);
    assert.equal(stage, scenario);
    assert.equal(payload.deviceId, "ESP32-VIRTUAL-01");
    assert.equal(Object.keys(payload).length, 11);
    for (const field of sensorKeys) {
      assert.equal(typeof payload[field], "number", scenario + ":" + field);
      assert.ok(Number.isFinite(payload[field]));
      assert.ok(payload[field] >= 0);
    }
    assert.ok(payload.humidity <= 100);
    assert.ok(payload.gasModuleC > 0);
    assert.deepEqual(payload.sensors, {
      cwt: { online: true, errors: 0 },
      ebyte: { online: true, ch4Connected: true, ch5Connected: true, errors: 0 },
      zeh100: { online: true, dataValid: true, warmupLike: false, flags: 0, errors: 0 }
    });
  }
});

test("all sensor states preserve the complete diagnostics contract", () => {
  for (const sensorState of SENSOR_STATES) {
    const { payload } = generatePayload({ sensorState, scenario: "active" }, 4);
    assert.equal(payload.deviceId, "ESP32-VIRTUAL-01");
    assert.equal(typeof payload.sensors.cwt.online, "boolean", sensorState);
    assert.equal(typeof payload.sensors.ebyte.ch4Connected, "boolean", sensorState);
    assert.equal(typeof payload.sensors.zeh100.dataValid, "boolean", sensorState);
    for (const key of ["cwt", "ebyte", "zeh100"]) {
      assert.ok(Number.isSafeInteger(payload.sensors[key].errors), sensorState);
      assert.ok(payload.sensors[key].errors >= 0, sensorState);
    }
    assert.ok(payload.gasModuleC === null ||
      (typeof payload.gasModuleC === "number" && payload.gasModuleC >= -50 && payload.gasModuleC <= 150));
  }
});

test("warm-up and individual RS485 faults suppress only affected measurements", () => {
  const generate = sensorState => generatePayload({ scenario: "active", sensorState }, 0).payload;
  const warmup = generate("warmup");
  assert.equal(warmup.sensors.zeh100.warmupLike, true);
  assert.equal(warmup.sensors.zeh100.dataValid, false);
  assert.equal(warmup.sensors.zeh100.flags, null);
  assert.equal(warmup.gasModuleC, -40);
  assert.equal(warmup.co, null);
  assert.equal(warmup.h2, null);
  assert.equal(warmup.voc, null);
  assert.ok(warmup.furnace > 0);

  const cwt = generate("cwt-fault");
  assert.equal(cwt.sensors.cwt.online, false);
  assert.equal(cwt.ambient, null);
  assert.equal(cwt.humidity, null);
  assert.ok(cwt.furnace > 0);

  const ch4 = generate("ch4-fault");
  assert.equal(ch4.sensors.ebyte.online, true);
  assert.equal(ch4.sensors.ebyte.ch4Connected, false);
  assert.equal(ch4.sensors.ebyte.ch5Connected, true);
  assert.equal(ch4.stack, null);
  assert.ok(ch4.furnace > 0);

  const ch5 = generate("ch5-fault");
  assert.equal(ch5.sensors.ebyte.ch4Connected, true);
  assert.equal(ch5.sensors.ebyte.ch5Connected, false);
  assert.equal(ch5.furnace, null);
  assert.ok(ch5.stack > 0);

  const ebyte = generate("ebyte-fault");
  assert.equal(ebyte.sensors.ebyte.online, false);
  assert.equal(ebyte.furnace, null);
  assert.equal(ebyte.stack, null);

  const zeh = generate("zeh-fault");
  assert.equal(zeh.sensors.zeh100.online, false);
  assert.equal(zeh.sensors.zeh100.dataValid, false);
  assert.equal(zeh.gasModuleC, null);
  assert.equal(zeh.co, null);
  assert.equal(zeh.h2, null);
  assert.equal(zeh.voc, null);

  const flags = generate("zeh-flags");
  assert.equal(flags.sensors.zeh100.online, true);
  assert.equal(flags.sensors.zeh100.flags, 1);
  assert.equal(flags.sensors.zeh100.warmupLike, false);
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
  assert.equal(parseOptions([]).interval, 10);
  assert.equal(parseOptions([]).sensorState, "ready");
  assert.equal(parseOptions(["--sensor-state", "zeh-fault"]).sensorState, "zeh-fault");
  assert.throws(() => parseOptions(["--sensor-state", "unknown"]), /sensor/i);
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
