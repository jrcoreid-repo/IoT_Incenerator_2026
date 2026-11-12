"use client";

import { Activity, AlertTriangle, CloudSun, Flame, Gauge, RadioTower, ShieldAlert, ShieldCheck, Thermometer, Wind } from "lucide-react";
import type { Telemetry } from "@/lib/telemetry";

type Health = "ready" | "warmup" | "fault" | "offline" | "unknown";
type ValueKey = "furnace" | "stack" | "ambient" | "humidity" | "co" | "h2" | "voc";
type IconType = typeof Flame;
const POINTS = {
  furnace: { x: 900 / 1920 * 100, y: 780 / 1080 * 100 },
  stack: { x: 1235 / 1920 * 100, y: 640 / 1080 * 100 },
  gas: { x: 1170 / 1920 * 100, y: 200 / 1080 * 100 },
  ambient: { x: 700 / 1920 * 100, y: 350 / 1080 * 100 }
} as const;

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
function Overlay({ kind, children }: { kind: keyof typeof POINTS; children: React.ReactNode }) {
  const point = POINTS[kind];
  return <div className={"inc-overlay inc-overlay-" + kind} style={{ left: point.x + "%", top: point.y + "%" }}>
    <span className="inc-target" aria-hidden="true" />
    <div className="inc-overlay-card">{children}</div>
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
    <div className="inc-stage">
      {/* Traced from the image supplied for this dashboard. Coordinates are relative to 1920 × 1080. */}
      <img src="/incinerator-overlay.svg" alt="Ilustrasi mesin incinerator: tungku pembakaran dan cerobong asap" width="1920" height="1080" className="inc-machine-art" />
      <Overlay kind="ambient">
        <div className="inc-overlay-heading"><CloudSun size={18} /><span>LINGKUNGAN</span></div>
        <div className="inc-pair">
          <Reading label="Suhu udara" value={measured("ambient")} unit="°C" icon={Thermometer}/>
          <Reading label="Kelembapan" value={measured("humidity")} unit="%RH" icon={Wind}/>
        </div>
        <Status health={sensorHealth("cwt", latest, fresh)} detail="CWT / ID 3"/>
      </Overlay>
      <Overlay kind="gas">
        <div className="inc-overlay-heading"><Gauge size={18} /><span>EMISI GAS / ZEH100</span></div>
        <div className="inc-gas-readings">
          <Reading label="CO" value={measured("co")} unit="ppm" icon={Gauge} digits={0}/>
          <Reading label="H₂" value={measured("h2")} unit="ppm" icon={Activity} digits={0}/>
          <Reading label="VOC" value={measured("voc")} unit="ppm" icon={Wind} digits={0}/>
        </div>
        <div className="inc-gas-module">Suhu modul <strong>{readable(fresh && gasValid ? latest?.gasModuleC : null, 0)} °C</strong></div>
        <Status health={gasHealth} detail={diagnostics?.zeh100.flags != null && diagnostics.zeh100.flags !== 0 ? "Flags: 0x" + diagnostics.zeh100.flags.toString(16).toUpperCase().padStart(2, "0") : "RS485 / ID 1"}/>
      </Overlay>
      <Overlay kind="stack">
        <div className="inc-overlay-heading"><RadioTower size={18}/><span>CEROBONG</span></div>
        <Reading label="CH4 · Suhu cerobong" value={measured("stack")} unit="°C" icon={Thermometer}/>
        <Status health={sensorHealth("ch4", latest, fresh)} detail="EBYTE / ID 2"/>
      </Overlay>
      <Overlay kind="furnace">
        <div className="inc-overlay-heading"><Flame size={18}/><span>TUNGKU</span></div>
        <Reading label="CH5 · Suhu tungku" value={measured("furnace")} unit="°C" icon={Flame}/>
        <Status health={sensorHealth("ch5", latest, fresh)} detail="EBYTE / ID 2"/>
      </Overlay>
    </div>
    <div className="inc-visual-bottom">
      <div className="inc-summary-cell"><Activity size={16}/><span>Indeks risiko berbasis aturan</span><strong>{fresh ? readable(riskIndex, 0) : "—"}<small>/100</small></strong></div>
      <div className="inc-summary-cell"><ShieldCheck size={16}/><span>Diagnostik perangkat</span><strong>{diagnostics && fresh ? "TERSEDIA" : "BELUM TERSEDIA"}</strong></div>
      <div className="inc-summary-cell"><AlertTriangle size={16}/><span>Nilai saat gangguan</span><strong>N/A, bukan nol</strong></div>
    </div>
    <p className="inc-visual-note">Status READY/FAULT mengacu pada diagnostik gateway jika tersedia. Pengirim dummy/legacy tidak mempunyai konfirmasi kesehatan sensor. Indeks risiko bukan hasil pengukuran emisi furan.</p>
  </section>;
}
