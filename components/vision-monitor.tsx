import { Activity, CameraOff, CloudFog, Eye, Info, MonitorPlay, Radio, Server, ShieldAlert, VideoOff } from "lucide-react";

const visionMetrics = [
  { label: "Keberadaan asap", value: "Belum dinilai", detail: "Deteksi visual", icon: Eye },
  { label: "Kepekatan asap", value: "—", detail: "Indikator visual", icon: CloudFog },
  { label: "Warna asap", value: "—", detail: "Putih / abu-abu / gelap", icon: Activity },
  { label: "Status analisis", value: "Menunggu kamera", detail: "Pemrosesan AI", icon: MonitorPlay }
];

// Design-only module: there is intentionally no camera stream, synthetic frame,
// result polling, or claimed AI measurement until a separate vision service exists.
export default function VisionMonitor() {
  return (
    <section className="vision-page" aria-label="Pantauan visual asap cerobong">
      <header className="vision-intro">
        <div>
          <p className="section-kicker">JRAIoT VISION</p>
          <h2>Pantauan Asap Cerobong</h2>
          <p>Kamera dan analisis visual akan membantu melihat perubahan asap dari waktu ke waktu.</p>
        </div>
        <span className="vision-stage-badge"><span className="vision-stage-dot" /> DALAM PERSIAPAN</span>
      </header>

      <div className="vision-layout">
        <section className="vision-video-panel" aria-label="Tampilan kamera cerobong">
          <div className="vision-video-top">
            <div className="vision-camera-name"><span className="vision-camera-icon"><VideoOff size={16} /></span><span>CAM 01 <small>·</small> CEROBONG</span></div>
            <span className="vision-offline-label"><span /> BELUM TERHUBUNG</span>
          </div>
          <div className="vision-video-center">
            <div className="vision-camera-placeholder"><CameraOff size={33} strokeWidth={1.65}/></div>
            <h3>Live kamera belum tersedia</h3>
            <p>Gambar cerobong akan muncul di sini setelah kamera dan server vision terhubung.</p>
          </div>
          <div className="vision-video-bottom">
            <span><Radio size={14} /> VIDEO BELUM AKTIF</span>
            <span>JRAIoT VISION / CAM 01</span>
          </div>
        </section>

        <aside className="vision-analysis-panel">
          <div className="vision-analysis-header">
            <div><p className="section-kicker">ANALISIS VISUAL</p><h3>Kondisi asap</h3></div>
            <span className="vision-pending-icon"><Eye size={20}/></span>
          </div>
          <p className="vision-analysis-description">Hasil analisis akan muncul otomatis saat kamera sudah aktif.</p>
          <div className="vision-metric-grid">
            {visionMetrics.map(({ label, value, detail, icon: Icon }) => (
              <div className="vision-metric" key={label}>
                <div className="vision-metric-heading"><span>{label}</span><Icon size={15} aria-hidden="true" /></div>
                <strong className={value === "—" ? "vision-metric-empty" : ""}>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <div className="vision-data-state"><Info size={17} /><p>Belum ada data kamera yang diterima. Tidak ada hasil analisis yang dibuat-buat.</p></div>
        </aside>
      </div>

      <div className="vision-info-row">
        <section className="vision-info-card">
          <span className="vision-info-icon"><Server size={21}/></span>
          <div>
            <h3>Server vision terpisah</h3>
            <p>Video nantinya diproses di server tersendiri. Website ini hanya menampilkan gambar, status, dan ringkasan hasilnya.</p>
          </div>
        </section>
        <section className="vision-info-card vision-caution-card">
          <span className="vision-info-icon"><ShieldAlert size={21}/></span>
          <div>
            <h3>Analisis visual, bukan uji emisi</h3>
            <p>Warna atau kepekatan asap tidak dapat memastikan kadar polutan maupun keamanan gas buang. Data sensor dan pengujian emisi tetap diperlukan.</p>
          </div>
        </section>
      </div>
    </section>
  );
}
