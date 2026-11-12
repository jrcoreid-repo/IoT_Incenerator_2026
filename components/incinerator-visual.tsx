"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CloudSun, Flame, Gauge, RadioTower, ShieldAlert, ShieldCheck, Thermometer, Wind } from "lucide-react";
import type { Telemetry } from "@/lib/telemetry";

type Health = "ready" | "warmup" | "fault" | "offline" | "unknown";
type ValueKey = "furnace" | "stack" | "ambient" | "humidity" | "co" | "h2" | "voc";
type IconType = typeof Flame;
// Coordinates are fixed on the 1920×1080 artwork and scale together with the picture.
const ARTWORK = { width: 1920, height: 1080 } as const;
// Mobile uses an independent portrait coordinate system (1080 × 1920).
// The gas panel and sensor dots are exact user-supplied positions.
// Ambient and furnace panel positions are provisional until confirmed.
const MOBILE_ARTWORK = { width: 1080, height: 1920 } as const;
const MOBILE_PANELS = {
  emission: { x: 48.15, y: 37.81, width: 990.79, height: 432.04 },
  ambient: { x: 55, y: 1570, width: 371.15, height: 323.68 },
  furnace: { x: 652, y: 1570, width: 371.15, height: 323.68 }
} as const;
const MOBILE_DOTS = {
  emission: { x: 550.36, y: 558.66 },
  furnace: { x: 567.75, y: 1260.81 }
} as const;
function mobilePanelStyle(name: keyof typeof MOBILE_PANELS) {
  const box = MOBILE_PANELS[name];
  return {
    left: (box.x / MOBILE_ARTWORK.width * 100) + "%",
    top: (box.y / MOBILE_ARTWORK.height * 100) + "%",
    width: (box.width / MOBILE_ARTWORK.width * 100) + "%",
    height: (box.height / MOBILE_ARTWORK.height * 100) + "%"
  };
}
const PANELS = {
  ambient: { x: 134, y: 186, width: 450, height: 300 },
  furnace: { x: 134, y: 676, width: 450, height: 300 },
  emission: { x: 1365, y: 153, width: 450, height: 675 }
} as const;
const TARGETS = {
  ambient: { x: 780, y: 281 },
  furnace: { x: 1000, y: 767 },
  emission: { x: 989, y: 73 }
} as const;

type PanelName = keyof typeof PANELS;
function panelStyle(kind: PanelName) {
  const box = PANELS[kind];
  return {
    left: box.x / ARTWORK.width * 100 + "%",
    top: box.y / ARTWORK.height * 100 + "%",
    width: box.width / ARTWORK.width * 100 + "%",
    height: box.height / ARTWORK.height * 100 + "%"
  };
}
const STATUS: Record<Health, string> = {
  ready: "READY", warmup: "WARMING UP", fault: "FAULT", offline: "OFFLINE", unknown: "BELUM TERKONFIRMASI"
};

function readable(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}
function sensorHealth(kind: "cwt" | "ch4" | "ch5" | "zeh", data: Telemetry | null, fresh: boolean): Health {
  if (!fresh) return "offline";
  const s = data?.sensors;
  if (!s) return "unknown"; // Legacy/dummy sender does not report sensor diagnostics.
  if (kind === "cwt") return !s.cwt.online ? "fault" : data?.ambient == null ? "fault" : "ready";
  if (kind === "ch4") return !s.ebyte.online || !s.ebyte.ch4Connected ? "fault" : "ready";
  if (kind === "ch5") return !s.ebyte.online || !s.ebyte.ch5Connected ? "fault" : "ready";
  if (!s.zeh100.online) return "fault";
  if (s.zeh100.warmupLike || !s.zeh100.dataValid) return "warmup";
  if (s.zeh100.flags !== null && s.zeh100.flags !== 0) return "fault";
  return "ready";
}

function Status({ health }: { health: Health }) {
  const Icon = health === "ready" ? ShieldCheck : health === "fault" ? ShieldAlert : health === "warmup" ? Activity : AlertTriangle;
  return <div className={"inc-health inc-health-" + health}><Icon size={12} aria-hidden="true" /><span>{STATUS[health]}</span></div>;
}
function Reading({ label, value, unit, icon: Icon, digits = 1 }: {
  label: string; value: number | null | undefined; unit: string; icon: IconType; digits?: number;
}) {
  return <div className="inc-reading">
    <div className="inc-reading-label"><Icon size={13} aria-hidden="true" />{label}</div>
    <div className="inc-reading-value">{readable(value, digits)}<span>{unit}</span></div>
  </div>;
}
function Panel({ kind, children }: { kind: PanelName; children: React.ReactNode }) {
  return <div className={"inc-fixed-panel inc-fixed-" + kind} style={panelStyle(kind)}>
    <div className="inc-overlay-card inc-fixed-card">{children}</div>
  </div>;
}
function MobileStatus({ health, name }: { health: Health; name: string }) {
  return <span className={"inc-mobile-status inc-mobile-" + health}>{name} · {STATUS[health]}</span>;
}
function IncineratorMobile({ latest, fresh, riskIndex }: {
  latest: Telemetry | null; fresh: boolean; riskIndex: number | null;
}) {
  const cwt = sensorHealth("cwt", latest, fresh);
  const ch4 = sensorHealth("ch4", latest, fresh);
  const ch5 = sensorHealth("ch5", latest, fresh);
  const zeh = sensorHealth("zeh", latest, fresh);
  const read = (key: ValueKey, digits = 0) => {
    const invalid = ((key === "ambient" || key === "humidity") && cwt === "fault")
      || (key === "stack" && ch4 === "fault")
      || (key === "furnace" && ch5 === "fault")
      || ((key === "co" || key === "h2" || key === "voc") && (zeh === "fault" || zeh === "warmup"));
    return readable(fresh && !invalid ? latest?.[key] : null, digits);
  };
  return <div className="inc-mobile-stage" aria-label="Skema incinerator mobile 1080 kali 1920">
    <img className="inc-mobile-artwork" src="/incinerator-mobile.png" alt="Gambar incinerator portrait dengan posisi sensor cerobong dan tungku" width={1080} height={1920}/>
    <svg className="inc-mobile-leaders" viewBox="0 0 1080 1920" preserveAspectRatio="none" aria-hidden="true">
      <path d={"M " + MOBILE_DOTS.emission.x + " " + MOBILE_DOTS.emission.y + " L 550.36 515 L 544 469.85"}/>
      <path d={"M " + MOBILE_DOTS.furnace.x + " " + MOBILE_DOTS.furnace.y + " L 613 1340 L 613 1615 L 652 1615"}/>
      <circle cx={MOBILE_DOTS.emission.x} cy={MOBILE_DOTS.emission.y} r="10"/>
      <circle cx={MOBILE_DOTS.furnace.x} cy={MOBILE_DOTS.furnace.y} r="10"/>
    </svg>
    <div className="inc-mobile-panel inc-mobile-emission" style={mobilePanelStyle("emission")}>
      <div className="inc-mobile-card">
        <div className="inc-mobile-header"><span>CEROBONG &amp; GAS</span><MobileStatus health={zeh} name="GAS"/></div>
        <div className="inc-mobile-emission-values">
          <div className="inc-mobile-stack"><small>SUHU CEROBONG</small><strong>{read("stack", 1)}<i>°C</i></strong></div>
          <div className="inc-mobile-three-gases">
            <div><small>CO</small><strong>{read("co")}<i>ppm</i></strong></div>
            <div><small>H₂</small><strong>{read("h2")}<i>ppm</i></strong></div>
            <div><small>VOC</small><strong>{read("voc")}<i>ppm</i></strong></div>
          </div>
        </div>
        <div className="inc-mobile-meta">
          <MobileStatus health={ch4} name="SUHU"/>
        </div>
        <div className="inc-mobile-furan">
          <div className="inc-mobile-furan-row"><span>PREDIKSI RISIKO FURAN</span><strong>{fresh ? readable(riskIndex, 0) : "—"}<i>/100</i></strong></div>
          <div className="inc-mobile-furan-track"><span style={{width: fresh && riskIndex !== null ? Math.max(0, Math.min(100, riskIndex)) + "%" : "0%"}}/></div>
        </div>
      </div>
    </div>
    <div className="inc-mobile-panel inc-mobile-ambient" style={mobilePanelStyle("ambient")}>
      <div className="inc-mobile-card">
        <div className="inc-mobile-header"><span>LINGKUNGAN</span></div>
        <div className="inc-mobile-double-values">
          <div><small>UDARA</small><strong>{read("ambient", 1)}<i>°C</i></strong></div>
          <div><small>LEMBAP</small><strong>{read("humidity", 1)}<i>%</i></strong></div>
        </div>
        <MobileStatus health={cwt} name="SENSOR"/>
      </div>
    </div>
    <div className="inc-mobile-panel inc-mobile-furnace" style={mobilePanelStyle("furnace")}>
      <div className="inc-mobile-card">
        <div className="inc-mobile-header"><span>SUHU TUNGKU</span></div>
        <div className="inc-mobile-furnace-value"><strong>{read("furnace", 1)}<i>°C</i></strong></div>
        <MobileStatus health={ch5} name="SENSOR"/>
      </div>
    </div>
  </div>;
}

export default function IncineratorVisual({ latest, fresh, riskIndex }: {
  latest: Telemetry | null; fresh: boolean; riskIndex: number | null;
}) {
  const gasHealth = sensorHealth("zeh", latest, fresh);
  const gasValid = fresh && (!latest?.sensors || latest.sensors.zeh100.dataValid);
  const measured = (key: ValueKey) => fresh && (key !== "co" && key !== "h2" && key !== "voc" || gasValid)
    ? latest?.[key] : null;
  // Default to an existing asset so an absent PNG cannot leave a broken-image icon.
  // Switch to the original, lossless PNG only after the browser confirms it loads.
  const [artworkSrc, setArtworkSrc] = useState("/incinerator-lineart-v3.svg");
  const [mobileArtworkReady, setMobileArtworkReady] = useState(false);
  useEffect(() => {
    let active = true;
    const candidate = new Image();
    candidate.onload = () => {
      if (active) setArtworkSrc("/incinerator-v4.png");
    };
    candidate.src = "/incinerator-v4.png";
    // Keep the existing mobile metric cards visible until a real portrait PNG
    // has been uploaded. No broken-image placeholder or misleading pointer dots.
    const portrait = new Image();
    portrait.onload = () => { if (active) setMobileArtworkReady(true); };
    portrait.src = "/incinerator-mobile.png";
    return () => {
      active = false;
      candidate.onload = null;
      portrait.onload = null;
    };
  }, []);
  return <section className={"inc-visual panel full-span" + (mobileArtworkReady ? " inc-mobile-ready" : "")} aria-label="Visualisasi incinerator dan pembacaan sensor">
    <div className="inc-visual-heading">
      <div><p className="section-kicker">PEMANTAUAN LANGSUNG</p><h2>Visualisasi Proses Pembakaran</h2><p className="muted">Pantau suhu, kondisi udara, dan gas pembakaran.</p></div>
      <div className={"inc-live-pill " + (fresh ? "inc-live-on" : "inc-live-off")}><span className={fresh ? "status-dot" : "offline-dot"}/>{fresh ? "DATA TERBARU" : "OFFLINE / MENUNGGU"}</div>
    </div>
    <div className="inc-stage inc-stage-v4">
      {/* Artwork and overlays share the same 1920×1080 coordinate system. */}
      <picture className="inc-machine-picture">
        <img src={artworkSrc} alt="Gambar teknis incinerator dengan tungku terbuka dan cerobong logam" width="1920" height="1080" className="inc-machine-art" />
      </picture>
      <svg className="inc-v4-leaders" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 780 281 L 676 281 L 584 315" />
        <path d="M 1000 767 L 730 767 L 584 826" />
        <path d="M 989 73 L 1220 73 L 1365 242" />
        <circle cx={TARGETS.ambient.x} cy={TARGETS.ambient.y} r="11"/>
        <circle cx={TARGETS.furnace.x} cy={TARGETS.furnace.y} r="11"/>
        <circle cx={TARGETS.emission.x} cy={TARGETS.emission.y} r="11"/>
      </svg>
      <Panel kind="ambient">
        <div className="inc-overlay-heading"><CloudSun size={19} /><span>KONDISI LINGKUNGAN</span></div>
        <div className="inc-pair">
          <Reading label="Suhu udara" value={measured("ambient")} unit="°C" icon={Thermometer}/>
          <Reading label="Kelembapan" value={measured("humidity")} unit="%RH" icon={Wind}/>
        </div>
        <Status health={sensorHealth("cwt", latest, fresh)}/>
      </Panel>
      <Panel kind="furnace">
        <div className="inc-overlay-heading"><Flame size={19}/><span>SUHU TUNGKU</span></div>
        <Reading label="Suhu pembakaran" value={measured("furnace")} unit="°C" icon={Flame}/>
        <Status health={sensorHealth("ch5", latest, fresh)}/>
      </Panel>
      <Panel kind="emission">
        <div className="inc-overlay-heading"><RadioTower size={19}/><span>CEROBONG &amp; GAS</span></div>
        <div className="inc-combined-section inc-combined-stack">
          <Reading label="Suhu cerobong" value={measured("stack")} unit="°C" icon={Thermometer}/>
          <Status health={sensorHealth("ch4", latest, fresh)}/>
        </div>
        <div className="inc-combined-section inc-combined-gas">
          <div className="inc-combined-label"><Gauge size={15} aria-hidden="true"/> KADAR GAS</div>
          <div className="inc-gas-readings">
            <Reading label="CO" value={measured("co")} unit="ppm" icon={Gauge} digits={0}/>
            <Reading label="H₂" value={measured("h2")} unit="ppm" icon={Activity} digits={0}/>
            <Reading label="VOC" value={measured("voc")} unit="ppm" icon={Wind} digits={0}/>
          </div>
          <Status health={gasHealth}/>
        </div>
        <div className="inc-furan-prediction" aria-label="Prediksi risiko furan dari analisis suhu dan gas">
          <div className="inc-furan-topline"><span>PREDIKSI RISIKO FURAN</span></div>
          <div className="inc-furan-score">{fresh ? readable(riskIndex, 0) : "—"}<small>/100</small></div>
          <div className="inc-furan-bar" role="meter" aria-label="Indeks risiko furan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fresh && riskIndex !== null ? Math.max(0, Math.min(100, riskIndex)) : undefined}>
            <span style={{width: fresh && riskIndex !== null ? Math.max(0, Math.min(100, riskIndex)) + "%" : "0%"}}/>
          </div>
          <div className="inc-furan-subtitle">{!fresh || riskIndex === null ? "Belum tersedia · menunggu data sensor" : "Indikator risiko dari suhu dan gas, bukan pengukuran furan langsung"}</div>
        </div>
        <div className="inc-gas-device-temperature" aria-label="Suhu pada sensor gas">
          <div className="inc-gas-device-temperature-label"><Thermometer size={15} aria-hidden="true"/><span>SUHU SENSOR GAS</span></div>
          <div className="inc-gas-device-temperature-value">{readable(fresh && gasHealth === "ready" ? latest?.gasModuleC : null, 1)}<small>°C</small></div>
        </div>
      </Panel>
    </div>
    {mobileArtworkReady && <IncineratorMobile latest={latest} fresh={fresh} riskIndex={riskIndex}/>}
    <p className="inc-visual-note">Status menunjukkan kondisi sensor dari perangkat. Prediksi risiko furan adalah perkiraan dari suhu dan gas, bukan hasil pengukuran langsung.</p>
  </section>;
}
