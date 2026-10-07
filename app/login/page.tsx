"use client";

import { FormEvent, useState } from "react";
import { Flame, LockKeyhole } from "lucide-react";

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
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark"><Flame size={24} /></div>
        <p className="eyebrow">JR-AIoT</p>
        <h1>Monitoring Cerobong</h1>
        <p className="muted">Masuk sebagai admin untuk membuka kontrol dan pengaturan sistem.</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Nama pengguna
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            Kata sandi
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button type="submit" disabled={loading}>
            <LockKeyhole size={17} />
            {loading ? "Memeriksa..." : "Masuk"}
          </button>
        </form>

        <p className="tiny-note">Kredensial diatur oleh admin melalui environment variable.</p>
      </section>
    </main>
  );
}
