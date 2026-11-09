"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Bell, BrainCircuit, Cloud, Cpu, Flame, Gauge, History, Home, LogOut, MapPin, Moon, Settings, ShieldCheck, Sun, Thermometer, Wifi, Wind } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Telemetry, TelemetryResponse, SensorKey } from "@/lib/telemetry";
import { DEFAULT_THRESHOLDS, evaluateLoT, type Thresholds, type RuleEvent } from "@/lib/logic-tree";

type TabId = "beranda" | "riwayat" | "ai" | "alarm" | "perangkat" | "pengaturan";
type ThresholdDraft = Record<keyof Thresholds, string>;
const navItems: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "beranda", label: "Beranda", icon: Home },
  { id: "riwayat", label: "Riwayat", icon: History },
  { id: "ai", label: "Analisis AI", icon: BrainCircuit },
  { id: "alarm", label: "Peringatan", icon: Bell },
  { id: "perangkat", label: "Perangkat", icon: Cpu },
  { id: "pengaturan", label: "Pengaturan", icon: Settings }
];
const thresholdKeys: (keyof Thresholds)[] = ["activeTemp", "transitionTemp", "coWarning", "vocWarning", "riskWarning"];
const thresholdLabels: Record<keyof Thresholds, string> = {
  activeTemp: "Batas suhu pembakaran aktif (°C)",
  transitionTemp: "Batas suhu transisi (°C)",
  coWarning: "Ambang internal CO (ppm)",
  vocWarning: "Ambang internal VOC (ppm)",
  riskWarning: "Ambang indeks risiko furan (0–100)"
};

function formatNumber(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" :
    value.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatClock(iso: string | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });
}
const TELEMETRY_OFFLINE_AFTER_MS = 15_000; // Five missed reports at the ESP32 3-second interval.
type SensorTone = "furnace" | "stack" | "co" | "voc" | "ambient" | "humidity" | "h2" | "smoke";
function MetricCard({ title, value, unit, icon: Icon, note, tone, offline = false }: {
  title: string; value: string; unit?: string; icon: typeof Home; note?: string; tone: SensorTone; offline?: boolean
}) {
  return (
    <article className={"metric-card sensor-card sensor-tone-" + tone}>
      <div className="metric-card-head"><div className="metric-icon"><Icon size={18} /></div></div>
      <div className="metric-body">
        <span className="metric-label">{title}</span>
        <div className="metric-value">{value}{unit && <small>{unit}</small>}</div>
        <span className="metric-note">{offline ? (value === "—" ? "OFFLINE · Belum ada pembacaan" : "OFFLINE · Data terakhir, bukan live") : note ?? (value === "—" ? "Menunggu pembacaan sensor" : "Pembacaan sensor terakhir")}</span>
      </div>
    </article>
  );
}
function DevicePill({ name, status, active }: { name: string; status: string; active: boolean }) {
  return (
    <div className="device-pill">
      <span className={active ? "status-dot" : "offline-dot"} />
      <div><strong>{name}</strong><small>{status}</small></div>
    </div>
  );
}
type StatusTone = "safe" | "caution" | "danger" | "critical" | "muted";

// Warna menunjukkan kondisi indikator internal, bukan hasil uji emisi lingkungan.
function riskPresentation(index: number | null, fresh: boolean): { label: string; tone: StatusTone } {
  if (!fresh || index === null) return { label: "BELUM TERSEDIA", tone: "muted" };
  if (index < 25) return { label: "NORMAL", tone: "safe" };
  if (index < 50) return { label: "WASPADA", tone: "caution" };
  if (index < 75) return { label: "BAHAYA", tone: "danger" };
  return { label: "KRITIS", tone: "critical" };
}

function monitoringPresentation(severity: "normal" | "warning" | "critical" | "unknown"): { label: string; tone: StatusTone } {
  if (severity === "normal") return { label: "NORMAL", tone: "safe" };
  if (severity === "warning") return { label: "WASPADA", tone: "caution" };
  if (severity === "critical") return { label: "BAHAYA", tone: "critical" };
  return { label: "BELUM TERSEDIA", tone: "muted" };
}

function EventList({ events, live }: { events: RuleEvent[]; live: boolean }) {
  if (!live) return <p className="no-data">Peringatan akan aktif setelah pembacaan terbaru tersedia.</p>;
  if (events.length === 0) return <p className="no-data no-data-normal"><span className="status-label risk-safe">NORMAL</span> Tidak ada peringatan pada parameter yang terbaca. Pantau pembacaan secara berkala.</p>;
  return (
    <div className="event-list">
      {events.map((event) => (
        <div className="event-row" key={event.code}>
          <span className={event.severity === "critical" ? "warning-dot" : "offline-dot"} />
          <div><strong>{event.title}</strong><small>{event.detail}</small></div>
          <span className={"event-level status-label risk-" + (event.severity === "critical" ? "critical" : "caution")}>{event.severity === "critical" ? "BAHAYA" : "WASPADA"}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardShell({ mode = "admin" }: { mode?: "admin" }) {
  const isAdmin = mode === "admin";
  const [tab, setTab] = useState<TabId>("beranda");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [latest, setLatest] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<Telemetry[]>([]);
  const [storageReady, setStorageReady] = useState(true);
  const [apiError, setApiError] = useState("");
  // Nilai awal harus identik antara SSR dan render pertama di browser.
  // Jam aktif diisi dari useEffect setelah hydration agar tidak berbeda pada HP.
  const [now, setNow] = useState(0);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [thresholdDraft, setThresholdDraft] = useState<ThresholdDraft>(() => ({
    activeTemp: String(DEFAULT_THRESHOLDS.activeTemp),
    transitionTemp: String(DEFAULT_THRESHOLDS.transitionTemp),
    coWarning: String(DEFAULT_THRESHOLDS.coWarning),
    vocWarning: String(DEFAULT_THRESHOLDS.vocWarning),
    riskWarning: String(DEFAULT_THRESHOLDS.riskWarning)
  }));
  const [settingsMessage, setSettingsMessage] = useState("");
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    const savedTheme = localStorage.getItem("adi-telemetry-theme-v2");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    const savedThresholds = localStorage.getItem("jr-thresholds");
    if (!savedThresholds) return;
    try {
      const parsed = JSON.parse(savedThresholds) as Partial<Thresholds>;
      const candidate: Thresholds = { ...DEFAULT_THRESHOLDS, ...parsed };
      if (thresholdKeys.some(key => typeof candidate[key] !== "number" || !Number.isFinite(candidate[key]))) return;
      setThresholds(candidate);
      setThresholdDraft({
        activeTemp: String(candidate.activeTemp), transitionTemp: String(candidate.transitionTemp),
        coWarning: String(candidate.coWarning), vocWarning: String(candidate.vocWarning),
        riskWarning: String(candidate.riskWarning)
      });
    } catch { /* konfigurasi tidak valid diabaikan */ }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("adi-telemetry-theme-v2", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    let working = false;
    async function refresh() {
      if (working) return;
      working = true;
      try {
        const response = await fetch("/api/telemetry", { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("Server telemetry tidak tersedia.");
        const data = await response.json() as TelemetryResponse;
        if (!active) return;
        setLatest(data.latest ?? null);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setStorageReady(data.storageReady);
        setApiError("");
      } catch {
        if (active) {
          setApiError("Koneksi ke server telemetry terputus.");
          // Keep the last successful reading visible, marked OFFLINE rather than live.
        }
      } finally {
        working = false;
        if (active) setNow(Date.now());
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    // Refresh halaman yang dipulihkan dari back/forward cache agar sesi dicek ulang.
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const ageMs = latest ? now - Date.parse(latest.receivedAt) : Infinity;
  const fresh = !!latest && ageMs >= -5000 && ageMs <= TELEMETRY_OFFLINE_AFTER_MS && !apiError;
  const offline = Boolean(apiError) || (!!latest && !fresh);
  const previous = history.length >= 2 ? history[history.length - 2] : null;
  const lot = useMemo(() => evaluateLoT(latest, previous, thresholds, fresh), [latest, previous, thresholds, fresh]);
  const chartData = useMemo(() => history.slice(-120).map((item, index, items) => ({
    ...item, waktu: new Date(item.receivedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    furanIndex: evaluateLoT(item, index ? items[index - 1] : null, thresholds).furanIndex
  })), [history, thresholds]);
  const showChart = history.length >= 2;
  const display = (key: SensorKey, digits = 1) => formatNumber(latest?.[key], digits);
  const sensorActive = (...keys: SensorKey[]) => fresh && keys.some(key => latest?.[key] !== null && latest?.[key] !== undefined);
  const virtualSource = latest?.deviceId.startsWith("ESP32-VIRTUAL") ?? false;
  const connectionLabel = !storageReady ? "PENYIMPANAN BELUM SIAP" : offline ? "OFFLINE · DATA TIDAK TERBARU" : fresh ? (virtualSource ? "PENGIRIM VIRTUAL TERHUBUNG" : "TELEMETRY ONLINE") : "MENUNGGU DATA SENSOR";
  // Hanya nilai suhu tungku yang valid dan terbaru menentukan status membakar/tidak.
  // Status ini berbeda dari bahaya emisi yang dihitung terpisah.
  const hasFurnaceReading = fresh && latest?.furnace !== null && latest?.furnace !== undefined;
  const isBurning = hasFurnaceReading && latest?.furnace !== null && latest?.furnace !== undefined && latest.furnace >= thresholds.activeTemp;
  const burnTone = offline ? "offline" : !hasFurnaceReading ? "unknown" : isBurning ? "burning" : "idle";
  const burnLabel = offline ? "OFFLINE — DATA TIDAK TERBARU" : !hasFurnaceReading ? "MENUNGGU DATA SUHU" : isBurning ? "SEDANG MEMBAKAR" : "TIDAK MEMBAKAR";
  const burnDescription = offline
    ? apiError
      ? "Koneksi ke server telemetry terganggu. Nilai yang terlihat adalah data terakhir, bukan pembacaan langsung."
      : `Tidak ada kiriman telemetry baru selama lebih dari ${TELEMETRY_OFFLINE_AFTER_MS / 1000} detik. Angka yang tampil adalah data terakhir, bukan pembacaan langsung.`
    : !hasFurnaceReading
      ? "Pembacaan suhu tungku belum tersedia."
      : isBurning
        ? `Suhu tungku mencapai batas aktif ${thresholds.activeTemp}°C. Pantau indikator gas secara terpisah.`
        : `Suhu tungku di bawah batas aktif ${thresholds.activeTemp}°C. Fase terdeteksi: ${lot.process.toLowerCase()}.`;
  const risk = offline ? { label: "OFFLINE", tone: "caution" as const } : riskPresentation(lot.furanIndex, fresh);
  const monitoring = offline ? { label: "OFFLINE", tone: "caution" as const } : monitoringPresentation(lot.severity);
  const visibleNavItems = isAdmin ? navItems : navItems.filter(item => item.id !== "pengaturan");

  function applyThresholdSettings() {
    const values = Object.fromEntries(thresholdKeys.map(key => [key, Number(thresholdDraft[key])])) as Thresholds;
    if (thresholdKeys.some(key => !thresholdDraft[key].trim() || !Number.isFinite(values[key]) || values[key] < 0)) {
      setSettingsMessage("Isi seluruh ambang dengan angka yang valid."); return;
    }
    if (values.transitionTemp >= values.activeTemp || values.activeTemp <= 0 ||
        values.coWarning <= 0 || values.vocWarning <= 0 || values.riskWarning > 100) {
      setSettingsMessage("Pastikan suhu transisi lebih rendah dari suhu aktif, ambang gas positif, dan indeks maksimal 100."); return;
    }
    setThresholds(values);
    localStorage.setItem("jr-thresholds", JSON.stringify(values));
    setSettingsMessage("Ambang tersimpan di browser pengelola ini.");
  }
  function resetThresholds() {
    setThresholds(DEFAULT_THRESHOLDS);
    setThresholdDraft(Object.fromEntries(thresholdKeys.map(key => [key, String(DEFAULT_THRESHOLDS[key])])) as ThresholdDraft);
    localStorage.removeItem("jr-thresholds");
    setSettingsMessage("Pengaturan kembali ke nilai awal.");
  }
  async function logout() {
    setLogoutError("");
    try {
      const response = await fetch("/api/logout", { method: "POST", cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Logout belum berhasil.");
      window.location.replace("/login");
    } catch {
      setLogoutError("Gagal keluar. Periksa koneksi lalu coba lagi.");
    }
  }

  return (
    <div className={"app-shell" + (offline ? " telemetry-offline" : "")}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true"><img src="/adi-logo.png" width={120} height={76} alt="" /></div>
          <div><strong>ADI Smart Incinerator</strong><span>PEMANTAUAN SUHU &amp; GAS</span></div>
        </div>
        <nav className="side-nav">
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon size={18} />{item.label}</button>;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="mini-status"><span className={fresh ? "status-dot" : "offline-dot"} /> {connectionLabel}</div>
          {isAdmin && <button className="logout-button" onClick={logout}><LogOut size={17} /> Keluar</button>}
          {logoutError && <p className="logout-error" role="alert">{logoutError}</p>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><img src="/adi-logo.png" width={120} height={76} alt="" /><span>ADI Smart Incinerator</span></div>
          <div className="topbar-heading"><p className="topbar-overline">ADI SMART INCINERATOR <span>/</span> PEMANTAUAN LINGKUNGAN</p><h1>{visibleNavItems.find(item => item.id === tab)?.label}</h1></div>
          <div className="top-actions">
            <span className="live-badge"><span className={fresh ? "status-dot" : "offline-dot"} /> {connectionLabel}</span>
            <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Ganti tema">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {tab === "beranda" && (
          <div className="page-grid">
            <section className="project-context">
              <div className="project-context-main"><div className="project-context-icon"><MapPin size={19} /></div>
                <div><span className="project-context-label">Lokasi instalasi</span><strong>Desa Caturharjo, Pandak, Bantul</strong></div>
              </div>
            </section>
            <section className={"hero-status burn-" + burnTone} aria-label="Status aktivitas pembakaran">
              <div className="hero-status-main">
                <div className="hero-icon-wrap"><Flame size={26} /></div>
                <div><p className="section-kicker">Status proses pembakaran</p>
                  <div className="combustion-state">{burnLabel}</div>
                  <p className="muted">{burnDescription}</p>
                  <span className="burn-legend">{offline ? "Kuning = koneksi/data terputus · Status pembakaran tidak dapat dipastikan" : "Merah = pembakaran berlangsung · Hijau = pembakaran belum aktif"}</span>
                </div>
              </div>
              <div className="hero-side">
                <div className="hero-mini"><span>Suhu tungku</span><strong>{display("furnace")} °C</strong></div>
                <div className="hero-mini"><span>Gas CO</span><strong>{display("co")} ppm</strong></div>
                <div className="hero-time"><span>Data terakhir diterima</span><strong>{formatClock(latest?.receivedAt)}</strong></div>
              </div>
            </section>
            <div className="section-title-row"><div><p className="section-kicker">Telemetry / Sensor</p><h2>Parameter utama</h2></div><span className="soft-badge">05 / PARAMETER</span></div>
            <section className="metric-grid" aria-label="Lima indikator utama">
              <MetricCard title="Suhu pembakaran" value={display("furnace")} unit="°C" icon={Flame} note="Sensor suhu tungku" tone="furnace" offline={offline} />
              <MetricCard title="Suhu cerobong" value={display("stack")} unit="°C" icon={Thermometer} note="Sensor suhu keluaran" tone="stack" offline={offline} />
              <MetricCard title="Gas CO" value={display("co")} unit="ppm" icon={Gauge} note="Karbon monoksida" tone="co" offline={offline} />
              <MetricCard title="Gas VOC" value={display("voc")} unit="ppm" icon={BarChart3} note="Senyawa organik volatil" tone="voc" offline={offline} />
              <article className={"metric-card furan-card risk-border-" + risk.tone}>
                <div className="metric-card-head"><div className="metric-icon"><Activity size={18} /></div><span className={"furan-level status-label risk-" + risk.tone}>{risk.label}</span></div>
                <div className="metric-body"><span className="metric-label">Prediksi risiko furan</span>
                  <div className="metric-value">{fresh ? formatNumber(lot.furanIndex, 0) : "—"}<small>/100</small></div>
                  <div className="furan-track" role="meter" aria-label="Skor prediksi risiko furan dari analisis suhu dan gas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fresh && lot.furanIndex !== null ? lot.furanIndex : undefined} aria-valuetext={!fresh ? "Analisis tidak tersedia, menunggu data sensor terbaru" : undefined}>
                    <span className={"risk-fill risk-" + risk.tone} style={{ width: (fresh && lot.furanIndex !== null ? lot.furanIndex : 0) + "%" }} />
                  </div>
                  <div className="prediction-note"><strong>{offline ? "ANALISIS DIJEDA" : "HASIL ANALISIS AI"}</strong><span>{offline ? "Menunggu data sensor terbaru" : "Berdasarkan suhu dan gas"}</span></div>
                </div>
              </article>
            </section>
            <section className="panel extra-metrics" aria-labelledby="extra-metrics-title">
              <div className="panel-heading">
                <div><p className="section-kicker">Pemantauan lingkungan</p><h2 id="extra-metrics-title">Parameter lingkungan dan gas lainnya</h2></div>
              </div>
              <div className="metric-grid">
                <MetricCard title="Suhu lingkungan" value={display("ambient")} unit="°C" icon={Cloud} tone="ambient" offline={offline} />
                <MetricCard title="Kelembapan" value={display("humidity")} unit="%" icon={Wind} tone="humidity" offline={offline} />
                <MetricCard title="Gas H₂" value={display("h2")} unit="ppm" icon={Activity} tone="h2" offline={offline} />
                <MetricCard title="Indikator asap" value={display("smoke", 3)} unit="dB/m" icon={Wind} tone="smoke" offline={offline} />
              </div>
            </section>
            <section className="panel chart-panel full-span">
              <div className="panel-heading"><div><p className="section-kicker">Grafik telemetry</p><h2>Tren suhu</h2></div><span className="chip">TEMPERATURE / °C</span></div>
              {showChart ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="waktu" minTickGap={28} /><YAxis /><Tooltip />
                  <Line type="monotone" dataKey="furnace" name="Tungku" stroke="#4ed7a2" strokeWidth={2.7} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="stack" name="Cerobong" stroke="#c2dd94" strokeWidth={2.3} dot={false} isAnimationActive={false} />
                </LineChart></ResponsiveContainer></div> : <p className="no-data">Grafik akan tersedia setelah beberapa pembacaan diterima.</p>}
            </section>
            <section className="panel simple-alert-panel">
              <div className="panel-heading"><div><p className="section-kicker">Pemantauan otomatis</p><h2>Perlu diperhatikan</h2></div><AlertTriangle size={20} /></div>
              <EventList events={lot.events} live={fresh} />
            </section>
            <section className="panel device-summary">
              <div className="panel-heading"><div><p className="section-kicker">Konektivitas</p><h2>Status perangkat</h2></div><ShieldCheck size={19} /></div>
              <div className="device-grid">
                <DevicePill name={virtualSource ? "Pengirim virtual" : "Alat pengirim data"} active={fresh} status={fresh ? "Data diterima" : offline ? "OFFLINE" : "Menunggu koneksi"} />
                <DevicePill name="Sensor suhu" active={sensorActive("furnace","stack")} status={sensorActive("furnace","stack") ? "Pembacaan tersedia" : "Belum terbaca"} />
                <DevicePill name="Sensor gas" active={sensorActive("co","voc","h2")} status={sensorActive("co","voc","h2") ? "Pembacaan tersedia" : "Belum terbaca"} />
                <DevicePill name="Sensor lingkungan" active={sensorActive("ambient","humidity")} status={sensorActive("ambient","humidity") ? "Pembacaan tersedia" : "Belum terbaca"} />
                <DevicePill name="Penyimpanan" active={storageReady} status={storageReady ? "Endpoint tersedia" : "Konfigurasi diperlukan"} />
              </div>
            </section>
          </div>
        )}

        {tab === "riwayat" && <section className="page-grid">
          <div className="panel full-span"><div className="panel-heading"><div><p className="section-kicker">Riwayat sensor</p><h2>Suhu pembakaran dan cerobong</h2></div><span className="chip">{history.length} REKAMAN</span></div>
            {showChart ? <div className="chart-large"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="waktu" minTickGap={24} /><YAxis /><Tooltip />
              <Line type="monotone" dataKey="furnace" name="Suhu Tungku" stroke="#4ed7a2" strokeWidth={2.7} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="stack" name="Suhu Cerobong" stroke="#c2dd94" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></div> : <p className="no-data">Belum ada rangkaian data untuk ditampilkan.</p>}
          </div>
          <div className="panel"><div className="panel-heading"><div><p className="section-kicker">Parameter gas</p><h2>CO, H₂, VOC</h2></div></div>
            {showChart ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="waktu" minTickGap={25} /><YAxis /><Tooltip />
              <Line type="monotone" dataKey="co" name="CO" stroke="#f4b16c" strokeWidth={2.3} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="h2" name="H₂" stroke="#a4aee9" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="voc" name="VOC" stroke="#65cbb4" strokeWidth={2.3} dot={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></div> : <p className="no-data">Menunggu data sensor gas.</p>}
          </div>
          <div className="panel"><div className="panel-heading"><div><p className="section-kicker">Analisis AI</p><h2>Prediksi risiko furan</h2></div></div>
            {showChart ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="waktu" minTickGap={25} /><YAxis domain={[0,100]} /><Tooltip />
              <Line type="monotone" dataKey="furanIndex" name="Skor prediksi (0–100)" stroke="#a1df8e" strokeWidth={2.7} dot={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></div> : <p className="no-data">Indeks akan dihitung setelah suhu, CO, dan VOC tersedia.</p>}
          </div>
        </section>}

        {tab === "ai" && <section className="page-grid">
          <div className="panel full-span ai-analysis">
            <div className="panel-heading"><div><p className="section-kicker">Logic of Tree / Rule-Based</p><h2>Analisis AI otomatis</h2></div><BrainCircuit size={24} /></div>
            <div className="analysis-score-row">
              <div><span>Status pembakaran</span><strong className={"process-text process-" + burnTone}>{burnLabel}</strong></div>
              <div><span>Status pemantauan</span><strong className={"status-label risk-" + monitoring.tone}>{monitoring.label}</strong></div>
              <div><span>Prediksi risiko furan</span><strong><span className={"status-label risk-" + risk.tone}>{risk.label}</span> {fresh ? formatNumber(lot.furanIndex,0) : "—"} / 100</strong></div>
              <div><span>Parameter tersedia</span><strong>{lot.validSensorCount} / 8 SENSOR</strong></div>
            </div>
            <div className="analysis-copy">
              <h3>Hasil analisis AI</h3><p>{lot.summary}</p>
              <h3>Tindakan yang disarankan</h3>
              <div className="lot-recommendations">
                {lot.recommendations.map((rec, index) => <p key={index}><span>{String(index+1).padStart(2,"0")}</span>{rec}</p>)}
              </div>
              <h3>Aturan yang terpicu</h3>
              <div className="rule-list">{lot.rules.map(rule => <span className="rule-tag" key={rule}>{rule.replaceAll("_"," ")}</span>)}</div>
            </div>
            <div className="prototype-note">Prediksi risiko furan dihitung melalui analisis berbasis aturan (LoT) dengan mempertimbangkan suhu pembakaran, CO, VOC, dan asap. Gunakan hasil pengukuran lapangan serta uji laboratorium untuk evaluasi emisi resmi.</div>
          </div>
        </section>}

        {tab === "alarm" && <section className="page-grid">
          <div className="panel full-span"><div className="panel-heading"><div><p className="section-kicker">Notifikasi proses</p><h2>Peringatan parameter</h2></div><Bell size={22} /></div>
            <EventList events={lot.events} live={fresh} />
            <p className="data-origin-note">Ambang bersifat pengaturan pemantauan internal; gunakan prosedur keselamatan dan pemeriksaan emisi yang berlaku untuk keputusan operasional.</p>
          </div>
        </section>}

        {tab === "perangkat" && <section className="page-grid">
          <div className="panel full-span"><div className="panel-heading"><div><p className="section-kicker">Perangkat & jaringan</p><h2>Koneksi perangkat</h2></div><Wifi size={22} /></div>
            <div className="device-table">
              <div className="device-table-row header"><span>Perangkat</span><span>Antarmuka</span><span>Status</span><span>Data terakhir</span></div>
              <div className="device-table-row"><strong>{virtualSource ? "Pengirim virtual" : "Alat pengirim data"}</strong><span>Koneksi data internet</span><span>{fresh ? "Terhubung" : "Tidak terhubung"}</span><span>{formatClock(latest?.receivedAt)}</span></div>
              <div className="device-table-row"><strong>Suhu tungku &amp; cerobong</strong><span>Kabel sensor</span><span>{sensorActive("furnace","stack") ? "Data tersedia" : "Belum terbaca"}</span><span>—</span></div>
              <div className="device-table-row"><strong>Sensor gas</strong><span>Kabel sensor</span><span>{sensorActive("co","voc","h2") ? "Data tersedia" : "Belum terbaca"}</span><span>—</span></div>
              <div className="device-table-row"><strong>Sensor lingkungan</strong><span>Kabel sensor</span><span>{sensorActive("ambient","humidity") ? "Data tersedia" : "Belum terbaca"}</span><span>—</span></div>
              <div className="device-table-row"><strong>Penyimpanan data</strong><span>Server pemantauan</span><span>{storageReady ? "Siap" : "Belum dikonfigurasi"}</span><span>—</span></div>
            </div>
          </div>
        </section>}

        {isAdmin && tab === "pengaturan" && <section className="page-grid">
          <div className="panel full-span settings-panel"><div className="panel-heading"><div><p className="section-kicker">Khusus pengelola</p><h2>Ambang analisis proses</h2></div><Settings size={22} /></div>
            <p className="muted">Nilai berikut mengatur analisis pada browser ini. Belum mengubah konfigurasi perangkat, server, atau batas regulasi.</p>
            <div className="settings-grid">{thresholdKeys.map(key => <label key={key}>{thresholdLabels[key]}
              <input inputMode="decimal" value={thresholdDraft[key]} onChange={event => {
                const raw = event.target.value;
                if (!/^\d*(\.\d*)?$/.test(raw)) return;
                setThresholdDraft(prev => ({ ...prev, [key]: raw }));
                setSettingsMessage("");
              }} />
            </label>)}</div>
            <div className="settings-actions">
              <button className="primary-button" onClick={applyThresholdSettings}>Simpan ambang</button>
              <button className="secondary-button" onClick={resetThresholds}>Kembali ke nilai awal</button>
              {settingsMessage && <span className="settings-message">{settingsMessage}</span>}
            </div>
          </div>
        </section>}
        <footer className="site-footer">
          <div className="footer-main"><span className="footer-dot" /><span>© {new Date().getFullYear()} <strong>ADI Smart Incinerator</strong> · Omah Inovasi Universitas Ahmad Dahlan</span></div>
          <div className="footer-sub">Didukung melalui Program Hibah Bestari · LPDP</div>
        </footer>
      </main>
      <nav className="mobile-nav" aria-label="Menu dashboard">
        {visibleNavItems.map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon size={19} /><span>{item.id === "ai" ? "Analisis" : item.label}</span></button>;
        })}
        <button type="button" onClick={logout} aria-label="Keluar dari dashboard"><LogOut size={19} /><span>Keluar</span></button>
      </nav>
    </div>
  );
}
