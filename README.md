# ADI Smart Incinerator · JR-AIoT

Dashboard **environmental telemetry** untuk Desa Caturharjo, Pandak, Bantul. Antarmuka hijau industrial, angka monospaced, grafik sensor, peringatan parameter, dan **Analisis AI berbasis LoT** (*logic tree / aturan if–else*).

## Alur sistem

```
Sensor RS485 → ESP32 / Gateway JR-AIoT → HTTPS POST /api/telemetry
                                           ↓
                                    Validasi token + data
                                           ↓
                                     Redis (produksi)
                                           ↓
                             GET /api/telemetry setiap 5 detik
                                           ↓
                      Dashboard + aturan LoT + indeks furan
```

**Tidak ada generator nilai sensor otomatis.** Saat ESP/gateway belum mengirim pembacaan, dashboard menampilkan **MENUNGGU DATA SENSOR** dan angka kosong (`—`). Jika data terakhir lebih dari 90 detik, status berganti **DATA TIDAK TERBARU** dan analisis otomatis tidak diberi status aktif.

## Tampilan operator dan arti warna

- Panel **Status proses pembakaran** dibuat kontras: **merah = sedang membakar** (suhu tungku mencapai ambang aktif), **hijau = tidak membakar** (suhu di bawah ambang aktif), **abu-abu = suhu tidak tersedia / data tidak terbaru**. Status ini menunjukkan *aktivitas* pembakaran, **bukan bahaya atau keamanan emisi**.
- Indikator risiko proses memiliki warna yang terpisah berdasarkan indeks LoT: **hijau NORMAL (0–24)**, **kuning WASPADA (25–49)**, **oranye BAHAYA (50–74)**, dan **merah KRITIS (75–100)**. Label tersebut hanya interpretasi indeks internal, bukan pengukuran furan/dioksin langsung.
- Pada Analisis AI, status pemantauan dibedakan berdasarkan apakah aturan LoT menemukan pelampauan ambang internal: **NORMAL**, **WASPADA**, atau **BAHAYA**.
- Identitas teknis internal seperti kode perangkat tetap ada dalam payload/API untuk integrasi, sedangkan antarmuka menggunakan bahasa awam: **Alat pengirim data**, **Sensor gas**, **Penyimpanan data**.
- Informasi Hibah Bestari dan LPDP berada di bagian bawah halaman, bersama hak cipta dan identitas Omah Inovasi Universitas Ahmad Dahlan.

## Tampilan dan fungsi

- Nuansa **hijau lingkungan** dengan komposisi industrial telemetry dan font Barlow, Barlow Condensed, IBM Plex Mono.
- Beranda: status pembakaran, suhu tungku, suhu cerobong, CO, VOC, dan **Prediksi Risiko Furan** dengan label **Hasil Analisis AI**.
- Parameter tambahan: suhu lingkungan, kelembapan, H₂, dan indikator asap (hanya muncul angkanya jika dikirim sensor).
- Riwayat: suhu, gas, dan grafik prediksi risiko furan. Penyimpanan mendukung 120 pembacaan terakhir di Redis.
- Analisis AI: **rule-based LoT / if–else**, tanpa ketergantungan API AI.
- Peringatan saat nilai melewati ambang yang diatur.
- Pengaturan ambang admin tersimpan **lokal di browser**, bukan di gateway maupun database.

\n### Bahasa pemantauan untuk operator\n\nKartu furan menampilkan **Prediksi Risiko Furan**, skor 0–100, tingkat risiko dengan warna, serta label **Hasil Analisis AI — Berdasarkan suhu dan gas**. Detail perhitungan berbasis aturan if–else (LoT) tersedia di halaman Analisis AI. Prediksi bersifat indikator awal proses dan perlu divalidasi dengan data lapangan serta pengukuran emisi yang sesuai sebelum dipakai untuk keputusan keselamatan atau regulasi.\n\n### Catatan tentang furan

**Furan tidak dibaca langsung oleh sensor yang disebut dalam proyek.** `Indeks risiko furan` ditampilkan sebagai **indikator heuristik 0–100**, dihitung melalui kondisi suhu, CO, VOC dan asap oleh `lib/logic-tree.ts`. Indeks ini **bukan** konsentrasi furan atau dioksin, tidak tervalidasi sebagai prediksi emisi, dan tidak dapat dipakai untuk menyatakan kepatuhan lingkungan atau keselamatan. Penilaian emisi tetap membutuhkan metode pengukuran yang tervalidasi. Ambang dalam kode adalah ambang pemantauan internal awal, bukan baku mutu lingkungan.

## Setup lokal (Windows)

```cmd
git switch design/minimal-operator-2026
git pull --ff-only origin design/minimal-operator-2026
npm install
copy .env.example .env.local
notepad .env.local
npm run dev
```

Isi `.env.local` (jika file tersebut sudah ada, jangan timpa). Syarat:
- `ADMIN_USERNAME`: nama pengguna pengelola
- `ADMIN_PASSWORD`: kata sandi kuat, minimum 12 karakter
- `SESSION_SECRET`: string acak minimum 32 karakter, untuk sesi admin bertanda tangan
- `TELEMETRY_INGEST_KEY`: token rahasia minimum 24 karakter untuk pengiriman data dari ESP
- `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`: diperlukan di produksi untuk menyimpan pembacaan secara persisten

Pada `npm run dev`, tanpa Redis data akan disimpan sementara di memori proses Node dan hilang saat restart. **Pada produksi, POST akan ditolak jika Redis belum dikonfigurasi.**

Halaman umum: `http://localhost:3000`, admin: `http://localhost:3000/login`.


## Virtual ESP32 sender (tanpa hardware)

Untuk menguji dashboard dengan data yang *dikirim melalui API yang sama* seperti ESP32 fisik, jalankan dua terminal Windows di folder proyek.

**Terminal 1 — server Next.js**

```cmd
npm run dev
```

**Terminal 2 — pengirim ESP32 virtual**

```cmd
npm run sender:virtual
```

Sebelum menjalankan sender, isi `TELEMETRY_INGEST_KEY` di `.env.local` dengan string acak minimal 24 karakter. Simpan file lalu restart `npm run dev` jika sebelumnya sudah berjalan. Sender membaca token yang sama dari `.env.local` secara otomatis, dan mengirim pembacaan setiap **3 detik** ke `http://localhost:3000/api/telemetry`. Dashboard melakukan polling setiap **5 detik**. Saat sender terhubung, status **PENGIRIM VIRTUAL TERHUBUNG** muncul.

**Pilih skenario dengan satu perintah:**

```cmd
npm run sender:virtual -- --scenario cycle
npm run sender:virtual -- --scenario active
npm run sender:virtual -- --scenario warning
npm run sender:virtual -- --scenario critical
npm run sender:virtual -- --scenario cooling
npm run sender:virtual -- --scenario cycle --phase-seconds 15
npm run sender:virtual -- --scenario critical --count 10
npm run sender:virtual -- --dry-run
```

Mode `cycle` otomatis berpindah dari **idle → heating → active → warning → critical → cooling**, dengan transisi halus antar tahap. Mode lain mempertahankan satu tahap untuk memeriksa LoT, grafik, dan alarm. Mode `--dry-run` menampilkan JSON tanpa mengirim apa pun.

Payload berisi `deviceId: "ESP32-VIRTUAL-01"` dan delapan pembacaan numerik (`furnace`, `stack`, `ambient`, `humidity`, `co`, `h2`, `voc`, `smoke`). **Nilai tersebut dihasilkan oleh program virtual**, tidak mewakili pengukuran atau tingkat emisi sebenarnya. Indeks risiko furan tetap dihitung di sisi dashboard melalui LoT, bukan dikirim sender.

- **Hentikan sender:** tekan `Ctrl+C` di Terminal 2. Pembacaan terakhir akan menjadi kedaluwarsa setelah sekitar 90 detik, dan analisis otomatis berhenti.
- **URL lain:** `npm run sender:virtual -- --url https://domainmu.id/api/telemetry`. Pengiriman non-lokal wajib HTTPS; gunakan token ingest yang sesuai pada server tujuan. Jangan gunakan ini untuk mengirim data uji ke instalasi produksi sungguhan.
- **Sebelum ESP32 fisik dipasang:** matikan sender virtual, gunakan `deviceId` yang berbeda untuk perangkat asli, lalu kirim JSON dengan skema yang sama.
- **Uji program sender:** `npm run test:sender` (Node.js 22).

## Mengirim data dari ESP/gateway

Endpoint:
- `POST /api/telemetry` untuk ESP/gateway, wajib header `Authorization: Bearer <TELEMETRY_INGEST_KEY>`
- `GET /api/telemetry` untuk dashboard, mengembalikan `latest`, `history`, dan `storageReady`

Payload JSON:

```json
{
  "deviceId": "JR-AIoT-01",
  "furnace": 256.5,
  "stack": 118.2,
  "ambient": 30.7,
  "humidity": 68,
  "co": 23.4,
  "h2": 8.1,
  "voc": 38.5,
  "smoke": 0.03
}
```

Angka di atas hanya menunjukkan **format pengiriman**, bukan pembacaan perangkat. Semua nilai sensor opsional, tetapi setidaknya satu harus berupa angka. Sensor yang belum terpasang boleh dihilangkan atau diisi `null`. Field harus bernilai number (bukan string angka). `furanRisk` **tidak diterima dari firmware**; indeks dihitung oleh LoT saat suhu tungku, CO, dan VOC tersedia.

Untuk menguji API dari Windows PowerShell (ganti token dengan nilai sebenarnya):

```powershell
$token = "<TOKEN_DARI_ENV_LOCAL>"
$payload = @{ deviceId = "JR-AIoT-01"; furnace = 256.5; stack = 118.2; co = 23.4; voc = 38.5 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/telemetry" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $payload
```

Pada perangkat ESP, gunakan HTTPS saat domain sudah aktif. **Token harus disimpan di firmware/konfigurasi perangkat, bukan pada JavaScript frontend.** Sesuaikan format dan kalibrasi pembacaan sensor dengan register serta satuan dari perangkat RS485 yang benar.

## Logic of Tree (LoT)

Lokasi: `lib/logic-tree.ts`. Aturan saat ini mencakup:
- Status idle, pemanasan, aktif, pendinginan, dan suhu tungku tidak tersedia.
- CO/VOC melampaui ambang dan dua kali ambang.
- Penurunan suhu cepat, anomali perbandingan suhu cerobong dan tungku.
- Lingkungan terlalu panas/lembap serta parameter sensor yang belum tersedia.
- Indeks furan dihitung hanya bila nilai suhu tungku, CO, VOC tersedia. Setiap aturan yang terpicu ditampilkan, bersama saran pemeriksaan.

**Jika sensor tidak terbaca, sistem tidak akan menyatakan kondisi aman.** Seluruh analisis bersifat bantuan pemantauan, bukan instruksi otomatis mengendalikan insinerator.

## Sebelum deploy ke domain

- Siapkan HTTPS dan Redis persisten, serta isi empat variabel keamanan di environment hosting.
- Uji koneksi HTTPS ESP ke domain dan pembacaan register sensor per perangkat; jangan menyimpulkan status sensor hanya dari koneksi gateway.
- Pengaturan ambang masih lokal per browser; perlu DB/otorisasi server jika ingin seragam untuk semua operator.
- Tambahkan pembatasan percobaan login, rate limiting POST, monitoring kegagalan, backup, retensi, log audit, serta pembatasan perangkat yang boleh mengirim data sebelum penggunaan publik.
- Uji hasil LoT dengan data lapangan, kalibrasi dan validasi laboratorium sebelum digunakan sebagai penilaian risiko emisi.

Branch kerja: `design/minimal-operator-2026`. Basis sebelumnya: `dashboard-v1`; `main` masih inisialisasi.
