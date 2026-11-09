# JR-AIoT — ADI Smart Incinerator

Antarmuka telemetry pemantauan suhu dan gas proses pembakaran di Desa Caturharjo, Pandak, Bantul.

## Antarmuka operator

- Gaya telemetry industrial: latar gelap, garis tipis, tanpa ilustrasi cerobong.
- Font **Barlow / Barlow Condensed** untuk antarmuka dan **IBM Plex Mono** untuk pembacaan angka. Font mempunyai alternatif sistem jika sumber Google Fonts tidak tersedia.
- Lima informasi di Beranda: suhu pembakaran, suhu cerobong, CO, VOC, **indeks risiko pembentukan furan**.
- Empat parameter lanjutan ada dalam bagian yang dapat dibuka; halaman Riwayat tetap memuat grafik indeks furan.
- Panel peringatan, daftar perangkat, analisis proses, dan pengaturan pengelola tetap tersedia.
- Dapat dibuka melalui komputer maupun ponsel.

## Sumber dan makna data

**Saat ini seluruh angka dan grafik berasal dari generator data contoh `lib/mock-data.ts`, bukan dari sensor RS485.** Tampilan secara eksplisit memperlihatkan **DATA CONTOH · SENSOR OFFLINE**.

Indeks risiko furan ditunjukkan sebagai skala *0–100*, **bukan nilai konsentrasi gas atau hasil ukur sensor furan**. Angka dihitung secara heuristik dari suhu, CO, VOC, dan indikator asap dengan rumus pada `components/dashboard-shell.tsx`. Rumus tersebut belum divalidasi secara ilmiah, sehingga tidak boleh dijadikan indikator keselamatan, standar emisi, maupun hasil pengujian laboratorium.

- Kategori peringatan CO/VOC memakai ambang yang dapat diedit untuk visualisasi data contoh, bukan standar resmi.
- Status perangkat masih **Belum tersambung**.
- Riwayat hanya mencakup data yang dibuat di browser selama sesi berjalan; belum disimpan di database.
- Konfigurasi ambang saat ini disimpan di localStorage browser pengelola, bukan pada gateway.

## Menjalankan di Windows (CMD / PowerShell)

```powershell
git fetch origin
git switch design/minimal-operator-2026
git pull --ff-only
npm install
npm run dev
```

Jika belum tersedia, buat `.env.local` dari `.env.example` lalu ubah `ADMIN_USERNAME` dan `ADMIN_PASSWORD`. Buka `http://localhost:3000` atau `http://localhost:3000/login`.

**Keamanan:** Autentikasi versi awal belum siap untuk deploy publik. Amankan mekanisme sesi, kredensial, serta akses API perangkat sebelum implementasi lapangan.

## Branch

- `main`: inisialisasi awal.
- `dashboard-v1`: basis antarmuka sebelumnya.
- `design/minimal-operator-2026`: antarmuka telemetry yang sedang dikembangkan.

Integrasi data gateway USR-EG118/RS485, API telemetry, database, dan analisis terkalibrasi belum dilakukan.
