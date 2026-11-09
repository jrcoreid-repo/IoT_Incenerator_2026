"use client";

import { FormEvent, useState } from "react";
import { Activity, ArrowRight, Eye, EyeOff, Leaf, LockKeyhole, ShieldCheck, Thermometer, Wind } from "lucide-react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Pertahankan endpoint, payload, sesi cookie, dan alur masuk yang sudah dipakai.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password")
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.message ?? "Belum berhasil masuk. Periksa akun dan coba lagi.");
        return;
      }

      window.location.href = "/admin";
    } catch {
      setError("Tidak dapat terhubung. Periksa koneksi internet dan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-split">
      <aside className="login-split-visual" aria-label="Informasi ADI Smart Incinerator">
        <div className="login-visual-top">
          <div className="login-brand">
            <div className="login-brand-symbol">
              <img src="/adi-logo.png" width={120} height={76} alt="" />
            </div>
            <div className="login-brand-copy">
              <span className="login-brand-eyebrow">SISTEM PEMANTAUAN LINGKUNGAN</span>
              <strong>ADI Smart Incinerator</strong>
            </div>
          </div>
          <div className="login-visual-index">ADI / 2026</div>
        </div>

        <div className="login-visual-content">
          <span className="login-section-number"><span /> ENVIRONMENTAL MONITORING</span>
          <h1>Teknologi untuk<br /><em>lingkungan</em> yang<br /> lebih baik.</h1>
          <p className="login-visual-system">
            Ahmad Dahlan IoT Incinerator System
            <span>by Universitas Ahmad Dahlan</span>
          </p>

          <div className="login-visual-graphic" aria-hidden="true">
            <div className="login-graphic-ring ring-a" />
            <div className="login-graphic-ring ring-b" />
            <div className="login-graphic-ring ring-c" />
            <div className="login-graphic-cross cross-horizontal" />
            <div className="login-graphic-cross cross-vertical" />
            <div className="login-graphic-core"><Leaf size={30} strokeWidth={1.35} /></div>
          </div>
          <div className="login-feature-list">
            <div><span className="login-feature-icon"><Thermometer size={18} /></span><span><strong>01 / SUHU</strong><small>Pemantauan suhu pembakaran</small></span></div>
            <div><span className="login-feature-icon"><Wind size={18} /></span><span><strong>02 / GAS</strong><small>Kondisi gas dan lingkungan</small></span></div>
            <div><span className="login-feature-icon"><Activity size={18} /></span><span><strong>03 / ANALISIS</strong><small>Ringkasan dan peringatan proses</small></span></div>
          </div>
        </div>

        <div className="login-visual-bottom">
          <span>DESA CATURHARJO · PANDAK · BANTUL</span>
          <span>ADI SMART INCINERATOR</span>
        </div>
      </aside>

      <section className="login-split-access" aria-labelledby="login-title">
        <div className="login-access-top">
          <span className="login-access-serial">ADI / ACCESS PANEL</span>
          <span className="login-access-secure"><ShieldCheck size={15} /> Akses pengelola</span>
        </div>

        <div className="login-access-content">
          <div className="login-mobile-identity">
            <span className="login-mobile-logo"><img src="/adi-logo.png" alt="" width={120} height={76} /></span>
            <span><strong>ADI Smart Incinerator</strong><small>Pemantauan Suhu &amp; Gas</small></span>
          </div>

          <div className="login-access-heading">
            <div className="login-access-line" aria-hidden="true" />
            <p className="login-access-kicker">MASUK KE SISTEM</p>
            <h2 id="login-title">Selamat datang.</h2>
            <p>Masukkan akun pengelola untuk mengakses dashboard dan pengaturan.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-access-form">
            <div className="login-field">
              <label htmlFor="username">Nama pengguna</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                disabled={loading}
                placeholder="Masukkan nama pengguna"
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Kata sandi</label>
              <div className="login-password-wrap">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  placeholder="Masukkan kata sandi"
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(current => !current)}
                  disabled={loading}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && <p className="login-access-error" role="alert">{error}</p>}
            <button className="login-access-submit" type="submit" disabled={loading}>
              <LockKeyhole size={17} aria-hidden="true" />
              <span>{loading ? "Memeriksa akun..." : "Masuk ke dashboard"}</span>
              {!loading && <ArrowRight size={17} aria-hidden="true" />}
            </button>
          </form>


        </div>

        <footer className="login-access-footer">
          <span>© {new Date().getFullYear()} ADI Smart Incinerator</span>
          <span>Omah Inovasi · Universitas Ahmad Dahlan</span>
        </footer>
      </section>
    </main>
  );
}
