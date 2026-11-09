"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, RefreshCcw, ShieldCheck, UserPlus, Users } from "lucide-react";

type Operator = { username: string; role: "operator"; active: boolean; createdAt: string; updatedAt: string };
type Feedback = { message: string; error: boolean } | null;

export default function UserManagement({ owner }: { owner: string }) {
  const [users, setUsers] = useState<Operator[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [resetValues, setResetValues] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/users", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) { window.location.replace("/login"); return; }
      if (response.status === 403) { window.location.replace("/dashboard"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Tidak dapat memuat daftar pengguna.");
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Koneksi ke server terputus.", error: true });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function send(url: string, method: "POST" | "PATCH", payload: Record<string, unknown>, action: string) {
    setBusy(action);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method, credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (response.status === 401) { window.location.replace("/login"); return false; }
      if (response.status === 403) { window.location.replace("/dashboard"); return false; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Perubahan akun gagal.");
      await reload();
      setFeedback({ message: "Perubahan akun berhasil disimpan.", error: false });
      return true;
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Server tidak dapat dihubungi.", error: true });
      return false;
    } finally { setBusy(""); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12) { setFeedback({ message: "Password harus minimal 12 karakter.", error: true }); return; }
    const ok = await send("/api/users", "POST", { username, password }, "create");
    if (ok) { setUsername(""); setPassword(""); }
  }

  async function setActive(user: Operator) {
    await send("/api/users/" + encodeURIComponent(user.username), "PATCH",
      { action: user.active ? "disable" : "enable" }, user.username);
  }

  async function resetPassword(user: Operator) {
    const value = resetValues[user.username] ?? "";
    if (value.length < 12) { setFeedback({ message: "Password baru minimal 12 karakter.", error: true }); return; }
    const ok = await send("/api/users/" + encodeURIComponent(user.username), "PATCH",
      { action: "reset-password", password: value }, user.username);
    if (ok) setResetValues(current => ({ ...current, [user.username]: "" }));
  }

  return (
    <section className="panel full-span user-management" aria-labelledby="user-management-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Hanya Admin · Kontrol akses</p>
          <h2 id="user-management-heading"><Users size={19} aria-hidden="true" /> Manajemen Pengguna</h2>
        </div>
        <span className="status-label risk-safe"><ShieldCheck size={14} /> ADMIN ONLY</span>
      </div>

      <div className="user-management-intro">
        <div><Lock size={18} /><span><strong>Admin utama: {owner}</strong><small>Dikelola lewat konfigurasi server. Tidak dapat diubah oleh Operator.</small></span></div>
        <p>Admin membuat akun Operator menggunakan username dan password. Operator hanya dapat memantau dashboard, grafik, analisis, perangkat, dan peringatan.</p>
      </div>

      <div className="user-management-columns">
        <form className="user-create-form" onSubmit={create}>
          <div className="user-form-heading"><UserPlus size={18}/><h3>Tambah Operator Baru</h3></div>
          <label htmlFor="operator-username">Username</label>
          <input id="operator-username" type="text" value={username} onChange={e => setUsername(e.target.value.toLowerCase())}
            pattern="[a-z][a-z0-9._-]{2,31}" minLength={3} maxLength={32}
            autoComplete="off" placeholder="contoh: operator01" required disabled={!!busy} />
          <label htmlFor="operator-password">Password</label>
          <div className="user-password-input">
            <input id="operator-password" type={showPassword ? "text" : "password"} value={password}
              onChange={e => setPassword(e.target.value)} minLength={12} maxLength={128}
              autoComplete="new-password" placeholder="Minimal 12 karakter" required disabled={!!busy}/>
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"} disabled={!!busy}>
              {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
            </button>
          </div>
          <p className="user-password-hint">Akun dibuat sebagai Operator (hanya baca). Tidak ada registrasi publik.</p>
          <button className="primary-button" type="submit" disabled={!!busy}>
            <UserPlus size={16} /> {busy === "create" ? "Menyimpan..." : "Buat Akun Operator"}
          </button>
        </form>

        <div className="user-list">
          <div className="user-form-heading">
            <Users size={18}/><h3>Daftar Operator ({users.length})</h3>
            <button type="button" className="user-refresh" onClick={() => void reload()} aria-label="Muat ulang daftar user" disabled={!!busy}><RefreshCcw size={17}/></button>
          </div>
          {loading ? <p className="muted">Memuat daftar operator...</p> :
            users.length === 0 ? <p className="no-data">Belum ada akun Operator. Buat akun pertama melalui formulir di sebelah.</p> :
            <div className="user-records">
              {users.map(user => (
                <article className="user-record" key={user.username}>
                  <div className="user-record-top">
                    <div><strong>{user.username}</strong><span className="user-role">USER · OPERATOR</span></div>
                    <span className={"status-label " + (user.active ? "risk-safe" : "risk-caution")}>
                      {user.active ? "AKTIF" : "NONAKTIF"}
                    </span>
                  </div>
                  <div className="user-record-actions">
                    <button type="button" className="secondary-button" onClick={() => void setActive(user)} disabled={!!busy}>
                      {user.active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <div className="user-reset-control">
                      <input type="password" placeholder="Password baru (min. 12)" aria-label={"Password baru untuk " + user.username}
                        minLength={12} maxLength={128} autoComplete="new-password"
                        value={resetValues[user.username] ?? ""}
                        onChange={e => setResetValues(current => ({ ...current, [user.username]: e.target.value }))}
                        disabled={!!busy}/>
                      <button type="button" className="secondary-button" onClick={() => void resetPassword(user)} disabled={!!busy}>
                        <KeyRound size={15}/> Reset
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          }
        </div>
      </div>
      {feedback && <p className={"user-feedback " + (feedback.error ? "user-feedback-error" : "user-feedback-ok")} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
      <p className="data-origin-note">Menonaktifkan atau mereset password operator akan membatalkan sesi lama saat permintaan berikutnya. Akun utama Admin tetap menggunakan pengaturan server.</p>
    </section>
  );
}
