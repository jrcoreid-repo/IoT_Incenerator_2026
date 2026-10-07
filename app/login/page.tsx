"use client";

import { FormEvent, useState } from "react";
import { BarChart3, Flame, Leaf, LockKeyhole, ShieldCheck } from "lucide-react";

function IncineratorVisual() {
  return (
    <div className="login-incinerator-wrap" aria-label="Ilustrasi ADI Smart Incinerator">
      <svg viewBox="0 0 680 430" className="login-incinerator-svg" role="img">
        <defs>
          <linearGradient id="loginBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1b5b4d" />
            <stop offset="100%" stopColor="#0b2f28" />
          </linearGradient>
          <linearGradient id="loginHeat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>
        </defs>

        <g opacity="0.12">
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={"v" + i} x1={40 + i * 52} y1="25" x2={40 + i * 52} y2="390" stroke="#91ead3" />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={"h" + i} x1="25" y1={45 + i * 52} x2="650" y2={45 + i * 52} stroke="#91ead3" />
          ))}
        </g>

        <rect x="55" y="338" width="555" height="18" rx="9" fill="#0a211c" />
        <rect x="78" y="352" width="510" height="10" rx="5" fill="#16443a" />

        <rect x="125" y="156" width="232" height="156" rx="20" fill="url(#loginBody)" stroke="#42d9b1" strokeOpacity="0.3" strokeWidth="3" />
        <rect x="158" y="190" width="98" height="88" rx="13" fill="#071b17" stroke="#42d9b1" strokeOpacity="0.35" strokeWidth="2" />
        <path d="M196 252 C184 235 185 219 196 205 C198 217 207 221 213 230 C219 218 230 207 228 190 C244 202 250 221 247 235 C244 254 229 266 211 266 C198 266 188 261 182 251 C187 255 192 256 196 252Z" fill="url(#loginHeat)" />

        <rect x="274" y="190" width="61" height="44" rx="9" fill="#102f28" stroke="#4ce0b8" strokeOpacity="0.3" />
        <rect x="284" y="200" width="41" height="10" rx="4" fill="#2dd4aa" opacity="0.75" />
        <circle cx="291" cy="221" r="4" fill="#22c55e" />
        <circle cx="304" cy="221" r="4" fill="#f59e0b" />
        <circle cx="317" cy="221" r="4" fill="#ef4444" />

        <rect x="357" y="191" width="126" height="43" rx="16" fill="#123d34" stroke="#42d9b1" strokeOpacity="0.25" strokeWidth="3" />
        <rect x="458" y="83" width="58" height="153" rx="17" fill="#194b40" stroke="#42d9b1" strokeOpacity="0.25" strokeWidth="3" />
        <rect x="447" y="69" width="80" height="21" rx="10" fill="#205e50" />

        <path d="M527 73 C545 55 568 59 575 75 C587 64 605 70 607 87 C610 107 586 116 569 107 C560 119 537 118 529 104 C516 106 505 96 507 82 C509 72 517 68 527 73Z" fill="#d1fae5" opacity="0.42" />

        <g>
          <circle cx="210" cy="158" r="9" fill="#f97316" />
          <line x1="210" y1="158" x2="210" y2="124" stroke="#f97316" strokeWidth="2" />
          <rect x="153" y="96" width="114" height="25" rx="12" fill="#fff7ed" />
          <text x="210" y="113" textAnchor="middle" fontSize="12" fontWeight="700" fill="#9a3412">Suhu Tungku</text>
        </g>

        <g>
          <circle cx="488" cy="175" r="9" fill="#06b6d4" />
          <line x1="488" y1="175" x2="563" y2="154" stroke="#06b6d4" strokeWidth="2" />
          <rect x="536" y="130" width="112" height="25" rx="12" fill="#ecfeff" />
          <text x="592" y="147" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0f766e">Suhu Cerobong</text>
        </g>

        <g>
          <circle cx="402" cy="191" r="9" fill="#ef4444" />
          <line x1="402" y1="191" x2="555" y2="216" stroke="#ef4444" strokeWidth="2" />
          <rect x="521" y="203" width="127" height="25" rx="12" fill="#fef2f2" />
          <text x="584" y="220" textAnchor="middle" fontSize="12" fontWeight="700" fill="#b91c1c">CO · H₂ · VOC</text>
        </g>

        <g>
          <rect x="541" y="291" width="9" height="40" rx="4" fill="#695143" />
          <circle cx="546" cy="279" r="23" fill="#22c55e" />
          <circle cx="529" cy="287" r="17" fill="#16a34a" />
          <circle cx="562" cy="288" r="17" fill="#4ade80" />
        </g>
      </svg>
    </div>
  );
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password")
      })
    });

    setLoading(false);
    if (!response.ok) {
      const data = await response.json();
      setError(data.message ?? "Gagal masuk.");
      return;
    }

    window.location.href = "/admin";
  }

  return (
    <main className="login-page login-page-v2">
      <section className="login-layout-v2">
        <div className="login-showcase">
          <div className="login-showcase-copy">
            <p className="login-kicker">ADI SMART INCINERATOR</p>
            <h2>Pemantauan pembakaran dan lingkungan dalam satu sistem.</h2>
            <p>
              Monitoring suhu, gas, asap, dan kondisi lingkungan untuk mendukung pengoperasian incinerator yang lebih terpantau.
            </p>
          </div>

          <IncineratorVisual />

          <div className="login-feature-row">
            <div><span className="login-feature-icon"><Flame size={16} /></span><strong>Pembakaran</strong><small>Status & suhu</small></div>
            <div><span className="login-feature-icon"><BarChart3 size={16} /></span><strong>Gas</strong><small>CO, H₂ & VOC</small></div>
            <div><span className="login-feature-icon"><Leaf size={16} /></span><strong>Lingkungan</strong><small>Suhu & kelembapan</small></div>
          </div>
        </div>

        <div className="login-form-side">
          <section className="login-card login-card-v2">
            <div className="brand-mark"><Flame size={24} /></div>
            <p className="login-kicker">ADI SMART INCINERATOR</p>
            <h1>Masuk ke Sistem</h1>
            <p className="muted">Masuk sebagai admin untuk membuka kontrol dan pengaturan sistem.</p>

            <div className="login-access-pill"><ShieldCheck size={14} /> Akses Admin</div>

            <form onSubmit={handleSubmit} className="login-form">
              <label>
                Nama pengguna
                <input name="username" autoComplete="username" required placeholder="Masukkan nama pengguna" />
              </label>
              <label>
                Kata sandi
                <input name="password" type="password" autoComplete="current-password" required placeholder="Masukkan kata sandi" />
              </label>
              {error && <div className="form-error">{error}</div>}
              <button type="submit" disabled={loading}>
                <LockKeyhole size={17} />
                {loading ? "Memeriksa..." : "Masuk"}
              </button>
            </form>

            <p className="tiny-note">ADI Smart Incinerator · by Omah Inovasi Universitas Ahmad Dahlan</p>
          </section>
        </div>
      </section>
    </main>
  );
}
