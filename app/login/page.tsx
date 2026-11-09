"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <main className="login-simple">
      <div className="login-simple-shell">
        <div className="login-simple-brand">
          <div className="login-simple-mark" aria-hidden="true">ADI</div>
          <div>
            <p className="login-simple-overline">Sistem Pemantauan Lingkungan</p>
            <h1>ADI Smart Incinerator</h1>
          </div>
        </div>

        <p className="login-simple-intro">
          Pemantauan suhu, gas, dan kondisi pembakaran dalam satu tampilan yang mudah dipahami.
        </p>

        <section className="login-simple-card" aria-labelledby="login-title">
          <h2 id="login-title">Masuk sebagai pengelola</h2>
          <p>Gunakan akun pengelola untuk mengubah pengaturan sistem.</p>

          <form onSubmit={handleSubmit} className="login-simple-form">
            <label htmlFor="username">Nama pengguna</label>
            <input id="username" name="username" autoComplete="username" required placeholder="Nama pengguna" />
            <label htmlFor="password">Kata sandi</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Kata sandi" />
            {error && <p className="login-simple-error" role="alert">{error}</p>}
            <button type="submit" disabled={loading}>
              <LockKeyhole size={17} />
              {loading ? "Memeriksa akun..." : "Masuk"}
            </button>
          </form>

          <a href="/" className="login-simple-link">
            Lihat halaman pemantauan umum <ArrowRight size={16} />
          </a>
        </section>

        <p className="login-simple-footer">Desa Caturharjo, Pandak, Bantul · by Omah Inovasi Universitas Ahmad Dahlan</p>
      </div>
    </main>
  );
}
