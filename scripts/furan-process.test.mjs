// Test the actual TypeScript rule module without changing production imports.
// This module has type-only dependencies, eliminated by transpileModule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const src = readFileSync(new URL("../lib/logic-tree.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const moduleExports = {};
runInNewContext(js, { exports: moduleExports });
const { evaluateLoT } = moduleExports;
const sample = (overrides = {}) => ({
  deviceId: "ADI-EG118-01",
  receivedAt: new Date().toISOString(),
  furnace: 31.4, stack: 30.7, ambient: 29.6, humidity: 69.4,
  co: 0, h2: 0, voc: 0, smoke: null, ...overrides
});

test("idle incinerator 31C and zero CO/VOC must never produce misleading 42/100", () => {
  const result = evaluateLoT(sample(), null);
  assert.equal(result.process, "TIDAK AKTIF");
  assert.equal(result.furanIndex, null);
  assert.equal(result.furanLevel, "TIDAK DINILAI");
  assert.ok(result.rules.includes("FURAN_PROCESS_IDLE"));
  assert.ok(!result.rules.includes("FURAN_INDEX_WARNING"));
});

test("idle furnace without chimney measurement must not fabricate a risk score", () => {
  const result = evaluateLoT(sample({ stack: null }), null);
  assert.equal(result.furanIndex, null);
  assert.ok(result.rules.includes("FURAN_IDLE_STACK_UNKNOWN"));
});

test("warm stack with idle furnace is not misclassified as safe", () => {
  const result = evaluateLoT(sample({ stack: 250 }), null);
  assert.equal(result.furanIndex, null);
  assert.ok(result.rules.includes("FURAN_COOLING_UNEVALUATED"));
  assert.ok(result.recommendations.some(x => x.includes("pendinginan")));
});

test("CO alert remains active even when furan index is paused", () => {
  const result = evaluateLoT(sample({ co: 200 }), null);
  assert.equal(result.furanIndex, null);
  assert.ok(result.events.some(x => x.code === "CO_HIGH"));
  assert.equal(result.severity, "critical");
});

test("active process may produce experimental index, but only when inputs exist", () => {
  const active = evaluateLoT(sample({ furnace: 220, stack: 160 }), null);
  assert.equal(active.process, "PEMBAKARAN AKTIF");
  assert.equal(active.furanIndex, 16);
  const missingGas = evaluateLoT(sample({ furnace: 220, voc: null }), null);
  assert.equal(missingGas.furanIndex, null);
});

test("stale data are never evaluated", () => {
  const res = evaluateLoT(sample({ furnace: 220, stack: 180 }), null, undefined, false);
  assert.equal(res.furanIndex, null);
});
