"use client";

import { Activity, AlertTriangle, CloudSun, Flame, Gauge, RadioTower, ShieldAlert, ShieldCheck, Thermometer, Wind } from "lucide-react";
import type { Telemetry } from "@/lib/telemetry";

type Health = "ready" | "warmup" | "fault" | "offline" | "unknown";
type ValueKey = "furnace" | "stack" | "ambient" | "humidity" | "co" | "h2" | "voc";
type IconType = typeof Flame;
// Coordinates are fixed on the 1920×1080 artwork and scale together with the picture.
const ARTWORK = { width: 1920, height: 1080 } as const;
const PANELS = {
  ambient: { x: 134, y: 186, width: 450, height: 300 },
  furnace: { x: 134, y: 676, width: 450, height: 300 },
  emission: { x: 1365, y: 153, width: 450, height: 635 }
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

function Status({ health, detail }: { health: Health; detail?: string }) {
  const Icon = health === "ready" ? ShieldCheck : health === "fault" ? ShieldAlert : health === "warmup" ? Activity : AlertTriangle;
  return <div className={"inc-health inc-health-" + health}><Icon size={12} aria-hidden="true" /><span>{STATUS[health]}</span>{detail && <small>{detail}</small>}</div>;
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
export default function IncineratorVisual({ latest, fresh, riskIndex }: {
  latest: Telemetry | null; fresh: boolean; riskIndex: number | null;
}) {
  const gasHealth = sensorHealth("zeh", latest, fresh);
  const gasValid = fresh && (!latest?.sensors || latest.sensors.zeh100.dataValid);
  const measured = (key: ValueKey) => fresh && (key !== "co" && key !== "h2" && key !== "voc" || gasValid)
    ? latest?.[key] : null;
  const diagnostics = latest?.sensors;
  return <section className="inc-visual panel full-span" aria-label="Visualisasi incinerator dan pembacaan sensor">
    <div className="inc-visual-heading">
      <div><p className="section-kicker">LIVE MONITORING / ADI INCINERATOR</p><h2>Visualisasi Proses Pembakaran</h2><p className="muted">Nilai sensor mengikuti posisi fisik pada ilustrasi. CH4 cerobong · CH5 tungku.</p></div>
      <div className={"inc-live-pill " + (fresh ? "inc-live-on" : "inc-live-off")}><span className={fresh ? "status-dot" : "offline-dot"}/>{fresh ? "TELEMETRY TERBARU" : "OFFLINE / MENUNGGU"}</div>
    </div>
    <div className="inc-stage inc-stage-v4">
      {/* Artwork and overlays share the same 1920×1080 coordinate system. */}
      <picture className="inc-machine-picture"><source type="image/avif" srcSet="/incinerator-v4.avif" /><img src="/incinerator-lineart-v3.svg" alt="Gambar teknis incinerator dengan tungku terbuka dan cerobong logam" width="1920" height="1080" className="inc-machine-art" /></picture>
      <svg className="inc-v4-leaders" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 780 281 L 676 281 L 584 315" />
        <path d="M 1000 767 L 730 767 L 584 826" />
        <path d="M 989 73 L 1220 73 L 1365 242" />
        <circle cx={TARGETS.ambient.x} cy={TARGETS.ambient.y} r="11"/>
        <circle cx={TARGETS.furnace.x} cy={TARGETS.furnace.y} r="11"/>
        <circle cx={TARGETS.emission.x} cy={TARGETS.emission.y} r="11"/>
      </svg>
      <Panel kind="ambient">
        <div className="inc-overlay-heading"><CloudSun size={19} /><span>PARAMETER LINGKUNGAN</span></div>
        <div className="inc-pair">
          <Reading label="Suhu udara" value={measured("ambient")} unit="°C" icon={Thermometer}/>
          <Reading label="Kelembapan" value={measured("humidity")} unit="%RH" icon={Wind}/>
        </div>
        <Status health={sensorHealth("cwt", latest, fresh)} detail="CWT / ID 3"/>
      </Panel>
      <Panel kind="furnace">
        <div className="inc-overlay-heading"><Flame size={19}/><span>SUHU TUNGKU</span></div>
        <Reading label="CH5 · Suhu pembakaran" value={measured("furnace")} unit="°C" icon={Flame}/>
        <Status health={sensorHealth("ch5", latest, fresh)} detail="EBYTE / ID 2"/>
      </Panel>
      <Panel kind="emission">
        <div className="inc-overlay-heading"><RadioTower size={19}/><span>CEROBONG &amp; EMISI GAS</span></div>
        <div className="inc-combined-section inc-combined-stack">
          <Reading label="CH4 · Suhu cerobong" value={measured("stack")} unit="°C" icon={Thermometer}/>
          <Status health={sensorHealth("ch4", latest, fresh)} detail="EBYTE / ID 2"/>
        </div>
        <div className="inc-combined-section inc-combined-gas">
          <div className="inc-combined-label"><Gauge size={15} aria-hidden="true"/> SENSOR GAS / ZEH100</div>
          <div className="inc-gas-readings">
            <Reading label="CO" value={measured("co")} unit="ppm" icon={Gauge} digits={0}/>
            <Reading label="H₂" value={measured("h2")} unit="ppm" icon={Activity} digits={0}/>
            <Reading label="VOC" value={measured("voc")} unit="ppm" icon={Wind} digits={0}/>
          </div>
          <div className="inc-gas-module">Suhu modul <strong>{readable(fresh && gasValid ? latest?.gasModuleC : null, 0)} °C</strong></div>
          <Status health={gasHealth} detail={diagnostics?.zeh100.flags != null && diagnostics.zeh100.flags !== 0 ? "Flags: 0x" + diagnostics.zeh100.flags.toString(16).toUpperCase().padStart(2, "0") : "RS485 / ID 1"}/>
        </div>
        <div className="inc-furan-prediction" aria-label="Prediksi risiko furan dari analisis suhu dan gas">
          <div className="inc-furan-topline"><span>PREDIKSI RISIKO FURAN</span><small>ANALISIS BERBASIS ATURAN</small></div>
          <div className="inc-furan-score">{fresh ? readable(riskIndex, 0) : "—"}<small>/100</small></div>
          <div className="inc-furan-bar" role="meter" aria-label="Indeks risiko furan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fresh && riskIndex !== null ? Math.max(0, Math.min(100, riskIndex)) : undefined}>
            <span style={{width: fresh && riskIndex !== null ? Math.max(0, Math.min(100, riskIndex)) + "%" : "0%"}}/>
          </div>
          <div className="inc-furan-subtitle">{!fresh || riskIndex === null ? "Belum tersedia · menunggu data sensor" : "Indikator risiko dari suhu dan gas, bukan pengukuran furan langsung"}</div>
        </div>
      </Panel>
    </div>
    <div className="inc-visual-bottom">
      <div className="inc-summary-cell"><ShieldCheck size={16}/><span>Diagnostik perangkat</span><strong>{diagnostics && fresh ? "TERSEDIA" : "BELUM TERSEDIA"}</strong></div>
      <div className="inc-summary-cell"><AlertTriangle size={16}/><span>Nilai saat gangguan</span><strong>N/A, bukan nol</strong></div>
    </div>
    <p className="inc-visual-note">Status READY/FAULT mengacu pada diagnostik gateway jika tersedia. Pengirim dummy/legacy tidak mempunyai konfirmasi kesehatan sensor. Indeks risiko bukan hasil pengukuran emisi furan.</p>
  </section>;
}
