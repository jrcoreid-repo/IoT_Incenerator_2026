import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the actual TypeScript rule modules; their imports are type-only.
const load = (path) => {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  runInNewContext(js, { exports });
  return exports;
};
const { evaluateLoT, DEFAULT_THRESHOLDS } = load("../lib/logic-tree.ts");
const { explainReadings } = load("../lib/lot-insights.ts");
const sample = (values = {}) => ({
  deviceId:"ADI-EG118-01", receivedAt: new Date().toISOString(),
  furnace:31.4, stack:30.7, ambient:29.6, humidity:69.4, co:0, h2:0, voc:0, smoke:null,
  ...values
});
const report = (current, previous = null, fresh = true) => {
  const lot = evaluateLoT(current, previous, DEFAULT_THRESHOLDS, fresh);
  return { lot, info: explainReadings(current,previous,lot,DEFAULT_THRESHOLDS,fresh) };
};
const byId = (info, id) => info.insights.find(x => x.id === id);
const readySensors = () => ({
  cwt:{online:true, errors:0},
  ebyte:{online:true,ch4Connected:true,ch5Connected:true,errors:0},
  zeh100:{online:true,dataValid:true,warmupLike:false,flags:0,errors:0}
});

test("idle 31C CO=0 VOC=0 is not a furan pollution rating", () => {
  const {lot,info} = report(sample());
  assert.equal(lot.furanIndex,null);
  assert.match(info.headline,/suhu tungku/i);
  assert.match(byId(info,"furan").explanation,/bukan kadar furan/i);
  assert.match(byId(info,"gas").explanation,/tidak membuktikan furan/i);
  assert.equal(info.insights.length,8);
});

test("offline or missing packet stops all sensor conclusions", () => {
  const old=report(sample({furnace:900,co:300}),null,false).info;
  assert.equal(old.insights.length,1);
  assert.equal(old.insights[0].id,"connection");
  assert.match(old.headline,/belum masuk/i);
  const missing=report(null).info;
  assert.equal(missing.insights.length,1);
  assert.match(missing.subheading,/Tidak ada suhu/i);
});

test("ZEH warmup makes gas unavailable even if previous numeric values are present", () => {
  const sensors=readySensors();
  sensors.zeh100.dataValid=false;
  sensors.zeh100.warmupLike=true;
  const {lot,info}=report(sample({furnace:220,stack:180,sensors,co:0,voc:0,h2:0}));
  assert.equal(lot.furanIndex,null);
  assert.equal(byId(info,"gas").status,"MASIH WARM-UP");
  assert.match(byId(info,"gas").explanation,/tidak boleh dianggap/i);
});

test("disconnected CH5 probe cannot generate a false temperature or furan score", () => {
  const sensors=readySensors();
  sensors.ebyte.ch5Connected=false;
  const {lot,info}=report(sample({furnace:250,sensors}));
  assert.equal(lot.furanIndex,null);
  assert.equal(byId(info,"furnace").status,"BELUM TERBACA");
  assert.equal(byId(info,"sensors").status,"PERLU DICEK");
});

test("CO above twice the warning limit remains prominent even when idle", () => {
  const {lot,info}=report(sample({co:200}));
  assert.equal(lot.furanIndex,null);
  assert.equal(lot.severity,"critical");
  assert.equal(byId(info,"gas").tone,"alert");
  assert.match(info.headline,/segera diperiksa/i);
});

test("old/different sender cannot trigger fake rapid cooling", () => {
  const curr=sample({furnace:110});
  const other=sample({furnace:800,deviceId:"ANOTHER-DEVICE"});
  const older=sample({furnace:800,receivedAt:new Date(Date.now()-3600000).toISOString()});
  for (const prev of [other,older]) {
    const {lot,info}=report(curr,prev);
    assert.ok(!lot.rules.includes("RAPID_COOLING"));
    assert.equal(byId(info,"trend").status,"BELUM BISA DIBANDINGKAN");
  }
});

test("different devices and virtual sender are plainly identified", () => {
  const {info}=report(sample({deviceId:"ESP32-VIRTUAL-001"}));
  assert.match(info.subheading,/simulasi/i);
  assert.equal(byId(info,"quality").status,"DATA SIMULASI");
});

test("idle hot chimney is not classified as safe furan emission", () => {
  const {lot,info}=report(sample({stack:250}));
  assert.equal(lot.furanIndex,null);
  assert.equal(byId(info,"stack").tone,"attention");
  assert.match(byId(info,"furan").explanation,/bukan kadar furan/i);
});
