"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BrainCircuit,
  Cloud,
  Cpu,
  Flame,
  Gauge,
  History,
  Home,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Thermometer,
  Wifi,
  Wind
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { makeInitialData, nextTelemetry, Telemetry } from "@/lib/mock-data";

type TabId = "beranda" | "riwayat" | "ai" | "alarm" | "perangkat" | "pengaturan";

type Thresholds = {
  activeTemp: number;
  transitionTemp: number;
  coWarning: number;
  vocWarning: number;
  riskWarning: number;
};

const navItems: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "beranda", label: "Beranda", icon: Home },
  { id: "riwayat", label: "Riwayat & Grafik", icon: History },
  { id: "ai", label: "Analisis AI", icon: BrainCircuit },
  { id: "alarm", label: "Alarm & Kejadian", icon: Bell },
  { id: "perangkat", label: "Perangkat", icon: Cpu },
  { id: "pengaturan", label: "Pengaturan", icon: Settings }
];

const defaultThresholds: Thresholds = {
  activeTemp: 180,
  transitionTemp: 90,
  coWarning: 50,
  vocWarning: 75,
  riskWarning: 50
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calculateRisk(data: Telemetry, thresholds: Thresholds) {
  const lowTempPenalty = data.furnace < thresholds.activeTemp
    ? ((thresholds.activeTemp - data.furnace) / thresholds.activeTemp) * 38
    : 0;
  const coPenalty = (data.co / Math.max(thresholds.coWarning, 1)) * 22;
  const vocPenalty = (data.voc / Math.max(thresholds.vocWarning, 1)) * 24;
  const smokePenalty = Math.min(data.smoke / 0.08, 1) * 16;
  return Math.round(clamp(lowTempPenalty + coPenalty + vocPenalty + smokePenalty, 4, 96));
}

function combustionStatus(data: Telemetry, previous: Telemetry | undefined, thresholds: Thresholds) {
  const delta = previous ? data.furnace - previous.furnace : 0;

  if (data.furnace >= thresholds.activeTemp) return { text: "Pembakaran Aktif", tone: "good" };
  if (data.furnace >= thresholds.transitionTemp && delta >= 0) return { text: "Pemanasan", tone: "warn" };
  if (data.furnace >= thresholds.transitionTemp && delta < 0) return { text: "Pendinginan", tone: "warn" };
  return { text: "Tidak Aktif", tone: "muted" };
}

function riskLabel(value: number) {
  if (value <= 25) return "Rendah";
  if (value <= 50) return "Sedang";
  if (value <= 75) return "Tinggi";
  return "Kritis";
}

function aiInsight(data: Telemetry, thresholds: Thresholds) {
  if (data.furanRisk >= 75) {
    return "Risiko pembentukan dioksin/furan diprediksi tinggi. Terlihat kombinasi kondisi pembakaran yang kurang stabil dengan kenaikan parameter gas. Periksa suplai udara, kestabilan temperatur, dan kondisi proses.";
  }
  if (data.furanRisk >= thresholds.riskWarning) {
    return "Kondisi proses memerlukan perhatian. Suhu pembakaran dan tren CO/VOC menunjukkan pola yang dapat meningkatkan risiko pembentukan dioksin/furan. Pertahankan pembakaran stabil dan pantau perubahan parameter.";
  }
  if (data.furnace >= thresholds.activeTemp) {
    return "Pembakaran terpantau aktif dan relatif stabil. CO dan VOC belum menunjukkan peningkatan signifikan. Berdasarkan parameter yang tersedia, risiko pembentukan dioksin/furan saat ini diprediksi rendah.";
  }
  return "Unit belum berada pada kondisi pembakaran aktif penuh. Sistem terus memantau kenaikan suhu tungku, gas hasil pembakaran, dan kestabilan proses sebelum memberikan evaluasi risiko yang lebih kuat.";
}

function MetricCard({
  title,
  value,
  unit,
  icon: Icon,
  note
}: {
  title: string;
  value: string;
  unit?: string;
  icon: typeof Thermometer;
  note?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon"><Icon size={18} /></div>
      <div>
        <span className="metric-label">{title}</span>
        <div className="metric-value">
          {value}{unit && <small>{unit}</small>}
        </div>
        {note && <span className="metric-note">{note}</span>}
      </div>
    </article>
  );
}

function DevicePill({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="device-pill">
      <span className="status-dot" />
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export default function DashboardShell({ mode = "client" }: { mode?: "client" | "admin" }) {
  const isAdmin = mode === "admin";
  const [tab, setTab] = useState<TabId>("beranda");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [history, setHistory] = useState<Telemetry[]>(() => makeInitialData());
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds);

  useEffect(() => {
    const savedTheme = localStorage.getItem("jr-theme") as "light" | "dark" | null;
    const savedThresholds = localStorage.getItem("jr-thresholds");
    if (savedTheme) setTheme(savedTheme);
    if (savedThresholds) {
      try { setThresholds(JSON.parse(savedThresholds)); } catch {}
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("jr-theme", theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHistory((items) => {
        const current = items[items.length - 1];
        const preliminary = nextTelemetry(current, current.furanRisk);
        const risk = calculateRisk(preliminary, thresholds);
        const next = { ...preliminary, furanRisk: risk };
        return [...items.slice(-47), next];
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [thresholds]);

  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const status = combustionStatus(current, previous, thresholds);
  const insight = aiInsight(current, thresholds);

  const alarms = useMemo(() => {
    const rows = [
      current.co > thresholds.coWarning && {
        level: "Peringatan",
        title: "CO melewati ambang",
        detail: `${current.co.toFixed(1)} ppm · ambang ${thresholds.coWarning} ppm`
      },
      current.voc > thresholds.vocWarning && {
        level: "Peringatan",
        title: "VOC melewati ambang",
        detail: `${current.voc.toFixed(1)} ppm · ambang ${thresholds.vocWarning} ppm`
      },
      current.furanRisk > thresholds.riskWarning && {
        level: "Analisis",
        title: "Risiko dioksin/furan meningkat",
        detail: `Indeks saat ini ${current.furanRisk}/100`
      }
    ].filter(Boolean) as { level: string; title: string; detail: string }[];

    return rows.length ? rows : [{
      level: "Normal",
      title: "Tidak ada alarm aktif",
      detail: "Seluruh parameter berada dalam ambang konfigurasi."
    }];
  }, [current, thresholds]);

  function saveThresholds(next: Thresholds) {
    setThresholds(next);
    localStorage.setItem("jr-thresholds", JSON.stringify(next));
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const visibleNavItems = isAdmin ? navItems : navItems.filter((item) => item.id !== "pengaturan");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><Flame size={22} /></div>
          <div>
            <strong>JR-AIoT</strong>
            <span>Monitoring Cerobong</span>
          </div>
        </div>

        <nav className="side-nav">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="mini-status"><span className="status-dot" /> {isAdmin ? "Mode Admin" : "Sistem terhubung"}</div>
          {isAdmin && <button onClick={logout} className="logout-button"><LogOut size={17} /> Keluar</button>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Unit Pembakaran #01</p>
            <h1>{visibleNavItems.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className="live-badge">{isAdmin ? <><ShieldCheck size={13} /> ADMIN</> : <><span className="status-dot" /> PEMANTAUAN</>}</span>
            <span className="live-badge"><span className="status-dot" /> DATA LANGSUNG</span>
            <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Ganti tema">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {tab === "beranda" && (
          <div className="page-grid">
            <section className="hero-status">
              <div>
                <p className="section-kicker">Status proses</p>
                <div className={`combustion-state ${status.tone}`}><Flame size={24} /> {status.text}</div>
                <p className="muted">Pembaruan otomatis setiap 3 detik · data prototipe simulasi</p>
              </div>
              <div className="hero-time">
                <span>Data terakhir</span>
                <strong>{current.waktu}</strong>
              </div>
            </section>

            <section className="metric-grid">
              <MetricCard title="Suhu Tungku" value={current.furnace.toFixed(1)} unit="°C" icon={Flame} note="Thermocouple CH1" />
              <MetricCard title="Suhu Cerobong" value={current.stack.toFixed(1)} unit="°C" icon={Thermometer} note="Thermocouple CH2" />
              <MetricCard title="Suhu Lingkungan" value={current.ambient.toFixed(1)} unit="°C" icon={Cloud} note={`${current.humidity.toFixed(0)}% RH`} />
              <MetricCard title="Kelembapan" value={current.humidity.toFixed(1)} unit="%RH" icon={Wind} note="Sensor lingkungan" />
              <MetricCard title="CO" value={current.co.toFixed(1)} unit="ppm" icon={Gauge} note={current.co > thresholds.coWarning ? "Perlu perhatian" : "Normal"} />
              <MetricCard title="H₂" value={current.h2.toFixed(1)} unit="ppm" icon={Activity} note="ZEH100" />
              <MetricCard title="VOC" value={current.voc.toFixed(1)} unit="ppm" icon={BarChart3} note={current.voc > thresholds.vocWarning ? "Perlu perhatian" : "Stabil"} />
              <MetricCard title="Indikator Asap" value={current.smoke.toFixed(3)} unit="dB/m" icon={Wind} note="Pasca-filter" />
            </section>

            <section className="panel chart-panel">
              <div className="panel-heading">
                <div><p className="section-kicker">Tren proses</p><h2>Suhu pembakaran</h2></div>
                <span className="chip">48 sampel terakhir</span>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="waktu" minTickGap={28} />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="furnace" name="Tungku" stroke="currentColor" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="stack" name="Cerobong" stroke="currentColor" strokeOpacity={0.42} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel ai-card">
              <div className="panel-heading">
                <div><p className="section-kicker">Prediksi risiko</p><h2>Dioksin / Furan</h2></div>
                <BrainCircuit size={22} />
              </div>
              <div className="risk-row">
                <div className={`risk-score risk-${riskLabel(current.furanRisk).toLowerCase()}`}>
                  <strong>{current.furanRisk}</strong><span>/100</span>
                </div>
                <div>
                  <span className="risk-label">{riskLabel(current.furanRisk)}</span>
                  <p className="muted">Estimasi kondisi proses, bukan pengukuran laboratorium langsung.</p>
                </div>
              </div>
              <div className="ai-insight">
                <span><BrainCircuit size={16} /> Wawasan AI · simulasi prototipe</span>
                <p>{insight}</p>
              </div>
            </section>

            <section className="panel device-summary">
              <div className="panel-heading"><div><p className="section-kicker">Kesehatan sistem</p><h2>Status perangkat</h2></div><ShieldCheck size={21} /></div>
              <div className="device-grid">
                <DevicePill name="JR-AIoT" detail="Gateway · online" />
                <DevicePill name="ZEH100" detail="Gas sensor · online" />
                <DevicePill name="ME31" detail="Thermocouple · online" />
                <DevicePill name="Sensor Lingkungan" detail="Temp/RH · online" />
                <DevicePill name="Server" detail="Cloud · online" />
              </div>
            </section>
          </div>
        )}

        {tab === "riwayat" && (
          <section className="page-grid">
            <div className="panel full-span">
              <div className="panel-heading">
                <div><p className="section-kicker">Riwayat & grafik</p><h2>Historis parameter proses</h2></div>
                <div className="range-tabs"><button className="active">1 Jam</button><button>6 Jam</button><button>24 Jam</button><button>7 Hari</button><button>30 Hari</button></div>
              </div>
              <div className="chart-large">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="waktu" minTickGap={24} />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="furnace" name="Suhu Tungku" stroke="currentColor" strokeWidth={2.6} dot={false} />
                    <Line type="monotone" dataKey="stack" name="Suhu Cerobong" stroke="currentColor" strokeOpacity={0.4} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel">
              <div className="panel-heading"><div><p className="section-kicker">Gas</p><h2>CO, H₂ & VOC</h2></div></div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="waktu" minTickGap={30} />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="co" name="CO" stroke="currentColor" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="h2" name="H₂" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="voc" name="VOC" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel">
              <div className="panel-heading"><div><p className="section-kicker">Prediksi</p><h2>Indeks risiko D/F</h2></div></div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="waktu" minTickGap={30} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="furanRisk" name="Risiko D/F" stroke="currentColor" strokeWidth={2.4} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}

        {tab === "ai" && (
          <section className="page-grid">
            <div className="panel full-span ai-analysis">
              <div className="panel-heading"><div><p className="section-kicker">Analisis AI</p><h2>Ringkasan kondisi pembakaran</h2></div><BrainCircuit size={24} /></div>
              <div className="analysis-score-row">
                <div><span>Risiko Dioksin/Furan</span><strong>{current.furanRisk}/100 · {riskLabel(current.furanRisk)}</strong></div>
                <div><span>Status Pembakaran</span><strong>{status.text}</strong></div>
                <div><span>Kualitas Data</span><strong>Baik</strong></div>
              </div>
              <div className="analysis-copy">
                <h3>Wawasan saat ini</h3>
                <p>{insight}</p>
                <h3>Rekomendasi sistem</h3>
                <p>Pertahankan kestabilan suhu proses, pantau tren CO dan VOC, serta konfirmasi hasil prediksi dengan metode laboratorium bila diperlukan untuk evaluasi emisi formal.</p>
              </div>
              <div className="prototype-note">Mode prototipe: teks wawasan saat ini dihasilkan dari rule-based engine. Integrasi AI API akan ditambahkan pada tahap berikutnya.</div>
            </div>
          </section>
        )}

        {tab === "alarm" && (
          <section className="page-grid">
            <div className="panel full-span">
              <div className="panel-heading"><div><p className="section-kicker">Alarm & kejadian</p><h2>Kondisi yang perlu diperhatikan</h2></div><AlertTriangle size={22} /></div>
              <div className="event-list">
                {alarms.map((alarm, index) => (
                  <div className="event-row" key={index}>
                    <span className={alarm.level === "Normal" ? "status-dot" : "warning-dot"} />
                    <div><strong>{alarm.title}</strong><small>{alarm.detail}</small></div>
                    <span className="event-level">{alarm.level}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "perangkat" && (
          <section className="page-grid">
            <div className="panel full-span">
              <div className="panel-heading"><div><p className="section-kicker">Perangkat</p><h2>Topologi JR-AIoT</h2></div><Wifi size={22} /></div>
              <div className="device-table">
                <div className="device-table-row header"><span>Perangkat</span><span>Antarmuka</span><span>Status</span><span>Data terakhir</span></div>
                <div className="device-table-row"><strong>JR-AIoT</strong><span>Ethernet / Wi-Fi / RS485</span><span className="online-text">Online</span><span>baru saja</span></div>
                <div className="device-table-row"><strong>ZEH100</strong><span>RS485 Modbus</span><span className="online-text">Online</span><span>3 dtk lalu</span></div>
                <div className="device-table-row"><strong>ME31</strong><span>RS485 Modbus</span><span className="online-text">Online</span><span>3 dtk lalu</span></div>
                <div className="device-table-row"><strong>Sensor Lingkungan</strong><span>RS485 Modbus</span><span className="online-text">Online</span><span>3 dtk lalu</span></div>
              </div>
            </div>
          </section>
        )}

        {isAdmin && tab === "pengaturan" && (
          <section className="page-grid">
            <div className="panel full-span settings-panel">
              <div className="panel-heading"><div><p className="section-kicker">Khusus admin</p><h2>Pengaturan ambang sistem</h2></div><Settings size={22} /></div>
              <p className="muted">Nilai di bawah tersimpan lokal untuk prototipe. Pada versi database, konfigurasi akan disimpan di server.</p>
              <div className="settings-grid">
                <label>Suhu pembakaran aktif (°C)<input type="number" value={thresholds.activeTemp} onChange={(e) => saveThresholds({ ...thresholds, activeTemp: Number(e.target.value) })} /></label>
                <label>Suhu transisi (°C)<input type="number" value={thresholds.transitionTemp} onChange={(e) => saveThresholds({ ...thresholds, transitionTemp: Number(e.target.value) })} /></label>
                <label>Ambang CO (ppm)<input type="number" value={thresholds.coWarning} onChange={(e) => saveThresholds({ ...thresholds, coWarning: Number(e.target.value) })} /></label>
                <label>Ambang VOC (ppm)<input type="number" value={thresholds.vocWarning} onChange={(e) => saveThresholds({ ...thresholds, vocWarning: Number(e.target.value) })} /></label>
                <label>Ambang risiko D/F<input type="number" min="0" max="100" value={thresholds.riskWarning} onChange={(e) => saveThresholds({ ...thresholds, riskWarning: Number(e.target.value) })} /></label>
              </div>
              <button className="secondary-button" onClick={() => saveThresholds(defaultThresholds)}>Kembalikan nilai awal</button>
            </div>
          </section>
        )}
      </main>

      <nav className="mobile-nav">
        {visibleNavItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon size={19} /><span>{item.id === "riwayat" ? "Riwayat" : item.id === "perangkat" ? "Device" : item.label.replace("Analisis ", "")}</span></button>;
        })}
      </nav>
    </div>
  );
}
