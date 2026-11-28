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
const {gasTrends,seriesTrends,buildTrendPlot,plotBreak,plotGapLimit} = await import("data:text/javascript;base64,"+Buffer.from(plotJs).toString("base64"));
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

test("all plotted channels use the same weighted filter without changing raw inputs",()=>{
  const raw=[0,10,30,10,0].map((v,i)=>({...gasPoint(i,v),furnace:100+v,stack:50+v,ambient:20+v,humidity:60+v,furanIndex:v}));
  const before=JSON.stringify(raw), p=seriesTrends(raw)[2];
  for(const [key,base] of Object.entries({coTrend:0,h2Trend:0,vocTrend:0,furnaceTrend:100,stackTrend:50,ambientTrend:20,humidityTrend:60,furanTrend:0})){
    assert.ok(Math.abs(p[key]-(base+130/9))<1e-10);
  }
  assert.equal(JSON.stringify(raw),before);
});
test("furan pause and individual missing sensor values stay null; time gaps break all plotted lines",()=>{
  const data=[
    {...gasPoint(0,1),furnace:100,ambient:30,humidity:70,furanIndex:80},
    {...gasPoint(1,2),furnace:110,ambient:null,humidity:71,furanIndex:null},
    {...gasPoint(2,3),furnace:120,ambient:35,humidity:72,furanIndex:20},
    {...gasPoint(100,4),furnace:200,ambient:40,humidity:80,furanIndex:90}
  ];
  const trends=seriesTrends(data,60000);
  assert.deepEqual(trends.map(p=>p.furanTrend),[80,null,20,90]);
  assert.deepEqual(trends.map(p=>p.ambientTrend),[30,null,35,40]);
  const plotted=buildTrendPlot(data);
  assert.equal(plotted.length,5);
  for(const key of Object.keys(plotted[3]).filter(k=>k.endsWith("Trend")))assert.equal(plotted[3][key],null);
  assert.equal(plotted[4].furnaceTrend,200);
  assert.deepEqual(buildTrendPlot([]),[]);
});

test("short gaps are interpolated only for sensor charts and marked as estimates",()=>{
  const raw=[{...gasPoint(0,10),ambient:20,furanIndex:80},{...gasPoint(1,null),ambient:null,furanIndex:null},{...gasPoint(2,30),ambient:24,furanIndex:20}];
  const before=JSON.stringify(raw), plotted=buildTrendPlot(raw);
  assert.equal(plotted[1].coTrend,20);
  assert.equal(plotted[1].ambientTrend,22);
  assert.equal(plotted[1].furanTrend,null);
  assert.ok(plotted[1].estimatedKeys.includes("coTrend"));
  assert.ok(plotted[1].estimatedKeys.includes("ambientTrend"));
  assert.deepEqual(plotted[0].estimatedKeys,[]);
  assert.equal(JSON.stringify(raw),before);
});
test("short time gaps bridge but device boundaries, long gaps and open ends remain empty",()=>{
  const raw=[gasPoint(0,0),gasPoint(1,0),gasPoint(10,90),gasPoint(11,90),gasPoint(12,100,"B"),gasPoint(13,null,"B")];
  const plot=buildTrendPlot(raw);
  assert.equal(plot[2].coTrend,45);
  assert.ok(plot[2].estimatedKeys.includes("coTrend"));
  assert.equal(plot[5].coTrend,null);
  assert.equal(plot.at(-1).coTrend,null);
  assert.equal(buildTrendPlot([gasPoint(0,0),gasPoint(1,0),gasPoint(100,90),gasPoint(101,90)])[2].coTrend,null);
});
