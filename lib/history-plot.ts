import type { Telemetry } from "./telemetry";
const keys = ["co","h2","voc","furnace","stack","ambient","humidity","furanIndex"] as const;
type PlotKey = typeof keys[number];
type PlotPoint = Pick<Telemetry,"receivedAt" | "deviceId"> & Partial<Record<PlotKey,number | null>>;
const valid = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
export function plotGapLimit(points: PlotPoint[]): number {
  const gaps=points.slice(1).map((p,i)=>Date.parse(p.receivedAt)-Date.parse(points[i].receivedAt)).filter(g=>Number.isFinite(g)&&g>0).sort((a,b)=>a-b);
  const median=gaps.length?(gaps[Math.floor(gaps.length/2)]+gaps[Math.floor((gaps.length-1)/2)])/2:0;
  return Math.max(60_000,2.5*median);
}
export function plotBreak(a: PlotPoint,b: PlotPoint,limit: number): boolean {
  const gap=Date.parse(b.receivedAt)-Date.parse(a.receivedAt);
  return a.deviceId!==b.deviceId || !Number.isFinite(gap) || gap<=0 || gap>limit;
}
// Centered triangular 5-point moving average. Never change source telemetry,
// fill nulls, or smooth across a detected time gap or device boundary.
export function seriesTrends(points: PlotPoint[],limit=plotGapLimit(points)) {
  function smooth(i: number,key: PlotKey): number | null {
    const center=points[i][key];
    if(!valid(center)) return null;
    let sum=3*center,weight=3;
    for(const direction of [-1,1]) for(let step=1;step<=2;step++){
      const j=i+direction*step,neighbor=points[j];
      if(!neighbor || plotBreak(points[Math.min(j,j-direction)],points[Math.max(j,j-direction)],limit)) break;
      const value=neighbor[key];
      if(!valid(value)) break;
      const w=3-step;
      sum+=w*value;weight+=w;
    }
    return sum/weight;
  }
  return points.map((p,i)=>({
    timeMs:Date.parse(p.receivedAt),
    coTrend:smooth(i,"co"),h2Trend:smooth(i,"h2"),vocTrend:smooth(i,"voc"),
    furnaceTrend:smooth(i,"furnace"),stackTrend:smooth(i,"stack"),
    ambientTrend:smooth(i,"ambient"),humidityTrend:smooth(i,"humidity"),
    furanTrend:smooth(i,"furanIndex")
  }));
}

/** Backward-compatible export for the original gas filter tests. */
export const gasTrends = seriesTrends;

/** Chart-only values and explicit break markers. Never send these to the
 * telemetry store, raw export, or rule-based analysis. */
export function buildTrendPlot(points: PlotPoint[]) {
  const limit=plotGapLimit(points);
  const trends=seriesTrends(points,limit);
  return trends.flatMap((point,i)=>{
    const prev=trends[i-1];
    if(!prev || !plotBreak(points[i-1],points[i],limit) || point.timeMs<=prev.timeMs) return [point];
    return [{
      timeMs:prev.timeMs+(point.timeMs-prev.timeMs)/2,
      coTrend:null,h2Trend:null,vocTrend:null,furnaceTrend:null,stackTrend:null,
      ambientTrend:null,humidityTrend:null,furanTrend:null
    },point];
  });
}
