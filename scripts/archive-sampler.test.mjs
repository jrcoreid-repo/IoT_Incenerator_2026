import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Tests the same TypeScript helper that the Next.js history endpoint imports.
const source = readFileSync(new URL("../lib/archive-chart-sampler.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const { ArchiveChartSampler, MAX_CHART_POINTS } =
  await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

function run(total) {
  const sampler = new ArchiveChartSampler();
  for (let i = 0; i < total; i++) {
    sampler.add({ deviceId: "ESP32-ADI-01", receivedAt: new Date(1794232800000 + i * 10000).toISOString(), furnace: i });
  }
  return sampler.finish();
}

test("archive shows empty state when there is no reading", () => {
  const result = run(0);
  assert.equal(result.total, 0);
  assert.deepEqual(result.history, []);
});
test("one point and brief ESP32 sessions render without downsampling", () => {
  for (const count of [1, 2, 11, 29, 299, 300]) {
    const result = run(count);
    assert.equal(result.total, count);
    assert.equal(result.history.length, count);
    assert.equal(result.sampled, false);
    assert.equal(result.chartBucketSeconds, 10);
    assert.equal(result.history.at(-1)?.furnace, count - 1);
  }
});
test("long sessions stay within 300 chart points and include newest record", () => {
  for (const count of [301, 600, 900, 10000, 60480]) {
    const result = run(count);
    assert.equal(result.total, count);
    assert.ok(result.history.length <= MAX_CHART_POINTS);
    assert.ok(result.history.length > 1);
    assert.equal(result.history[0].furnace, 0);
    assert.equal(result.history.at(-1).furnace, count - 1);
    assert.equal(result.sampled, true);
    for (let i = 1; i < result.history.length; i++) {
      assert.ok(result.history[i].furnace > result.history[i-1].furnace);
    }
  }
});

const plotSource = readFileSync(new URL("../lib/history-plot.ts",import.meta.url),"utf8");
const plotJs = ts.transpileModule(plotSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {gasTrends,plotBreak,plotGapLimit} = await import("data:text/javascript;base64,"+Buffer.from(plotJs).toString("base64"));
const gasPoint = (i,co,deviceId="A") => ({receivedAt:new Date(1794232800000+i*10000).toISOString(),deviceId,co,h2:co,voc:co});
test("gas chart filter is weighted, bounded, and does not modify raw readings",()=>{
  const data=[0,10,30,10,0].map((v,i)=>gasPoint(i,v));
  const original=JSON.stringify(data);
  const result=gasTrends(data);
  assert.equal(result[2].coTrend,130/9);
  assert.equal(JSON.stringify(data),original);
  assert.ok(result.every(p=>p.coTrend>=0 && p.coTrend<=30));
  assert.ok(gasTrends([0,0,0,0,0].map((v,i)=>gasPoint(i,v))).every(p=>p.coTrend===0));
});
test("gas chart filter does not cross missing values, time gaps, or device changes",()=>{
  const data=[gasPoint(0,10),gasPoint(1,null),gasPoint(2,90),gasPoint(100,0),gasPoint(101,100,"B")];
  assert.equal(plotGapLimit(data),60000);
  assert.ok(plotBreak(data[2],data[3],60000));
  assert.deepEqual(gasTrends(data,60000).map(p=>p.coTrend),[10,null,90,0,100]);
  assert.equal(gasTrends([gasPoint(0,42)])[0].coTrend,42);
});
