export type Telemetry = {
  waktu: string;
  furnace: number;
  stack: number;
  ambient: number;
  humidity: number;
  co: number;
  h2: number;
  voc: number;
  smoke: number;
  furanRisk: number;
};

export function makeInitialData(count = 24): Telemetry[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const phase = index / 3;
    return {
      waktu: new Date(now - (count - 1 - index) * 60_000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      furnace: 275 + Math.sin(phase) * 28 + index * 1.4,
      stack: 112 + Math.sin(phase * 0.8) * 13,
      ambient: 30.2 + Math.sin(phase * 0.3) * 1.1,
      humidity: 67 + Math.cos(phase * 0.4) * 4,
      co: 22 + Math.sin(phase * 1.2) * 6,
      h2: 7 + Math.cos(phase) * 2,
      voc: 37 + Math.sin(phase * 0.9) * 9,
      smoke: 0.03 + Math.max(0, Math.sin(phase)) * 0.018,
      furanRisk: 20 + Math.max(0, Math.sin(phase * 0.65)) * 18
    };
  });
}

export function nextTelemetry(prev: Telemetry, risk: number): Telemetry {
  const jitter = (scale: number) => (Math.random() - 0.5) * scale;
  return {
    waktu: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    furnace: Math.max(25, prev.furnace + jitter(9)),
    stack: Math.max(25, prev.stack + jitter(5)),
    ambient: Math.max(20, prev.ambient + jitter(0.35)),
    humidity: Math.min(95, Math.max(20, prev.humidity + jitter(1.6))),
    co: Math.max(0, prev.co + jitter(3.2)),
    h2: Math.max(0, prev.h2 + jitter(1.2)),
    voc: Math.max(0, prev.voc + jitter(4)),
    smoke: Math.max(0, prev.smoke + jitter(0.006)),
    furanRisk: risk
  };
}
