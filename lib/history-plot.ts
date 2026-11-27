import type { Telemetry } from "./telemetry";
const keys = ["co","h2","voc"] as const;
type GasKey = typeof keys[number];
type GasPoint = Pick<Telemetry, GasKey | "receivedAt" | "deviceId">;
const valid = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
export function plotGapLimit(points: GasPoint[]): number {
  const gaps=points.slice(1).map((p,i)=>Date.parse(p.receivedAt)-Date.parse(points[i].receivedAt)).filter(g=>Number.isFinite(g)&&g>0).sort((a,b)=>a-b);
  const median=gaps.length?(gaps[Math.floor(gaps.length/2)]+gaps[Math.floor((gaps.length-1)/2)])/2:0;
  return Math.max(60_000,2.5*median);
}
export function plotBreak(a: GasPoint,b: GasPoint,limit: number): boolean {
  const gap=Date.parse(b.receivedAt)-Date.parse(a.receivedAt);
  return a.deviceId!==b.deviceId || !Number.isFinite(gap) || gap<=0 || gap>limit;
}
// Centered triangular 5-point moving average. Never change source telemetry,
// fill nulls, or smooth across a detected time gap or device boundary.
export function gasTrends(points: GasPoint[],limit=plotGapLimit(points)) {
  function smooth(i: number,key: GasKey): number | null {
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
  return points.map((p,i)=>({timeMs:Date.parse(p.receivedAt),coTrend:smooth(i,"co"),h2Trend:smooth(i,"h2"),vocTrend:smooth(i,"voc")}));
}
