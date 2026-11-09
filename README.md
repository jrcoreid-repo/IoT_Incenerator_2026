# ADI Smart Incinerator · JR-AIoT

Dashboard **environmental telemetry** untuk Desa Caturharjo, Pandak, Bantul. Antarmuka hijau industrial, angka monospaced, grafik sensor, peringatan parameter, dan **Analisis AI berbasis LoT** (*logic tree / aturan if–else*).

## Persiapan deploy (staging online)

Sambil menunggu sensor RS485 fisik, dashboard bisa disiapkan sebagai **staging terproteksi**. Panduan langkah demi langkah untuk HTTPS, hosting, Upstash Redis, pemisahan token, perkiraan penggunaan dan syarat keamanan tersedia di [DEPLOYMENT.md](DEPLOYMENT.md).

Cek kesiapan konfigurasi melalui `npm run deploy:check` (tidak menampilkan isi password/token). Pengujian otomatis konfigurasi melalui `npm run test:deploy`. Firmware ESP32 saat ini **masih HTTP LAN**, jadi jangan langsung diganti menuju server internet sebelum TLS/HTTPS terverifikasi tersedia.

## Firmware ESP32 lokal

Firmware Arduino IDE pengirim data sensor dummy tersedia pada [firmware/adi_esp32_sender/adi_esp32_sender.ino](firmware/adi_esp32_sender/adi_esp32_sender.ino), lengkap dengan [panduan setup](firmware/README.md).

ESP32 dan laptop terhubung melalui Wi-Fi/LAN yang sama. Jalankan Next.js dengan `npm run dev -- -H 0.0.0.0`; salin `config.example.h` menjadi `config.h` (diabaikan Git), lalu isi Wi-Fi, IP laptop, dan token ingest yang sama dengan `.env.local`. Setelah upload, Serial Monitor 115200 menampilkan status HTTP (201 = diterima). Data dummy berubah setiap 3 detik melalui enam fase dan bisa diganti pembacaan RS485 fisik nanti.

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

**Tidak ada generator nilai sensor otomatis.** Saat ESP/gateway belum mengirim pembacaan, dashboard menampilkan **MENUNGGU DATA SENSOR** dan angka kosong (`—`). Jika data terakhir lebih dari 15 detik, status berganti **DATA TIDAK TERBARU** dan analisis otomatis tidak diberi status aktif.

## Arsip historis 10 detik / retensi otomatis 7 hari

**Pengiriman ESP32 tetap setiap 3 detik** agar status LIVE dan OFFLINE tetap responsif. Namun **database riwayat hanya menyimpan satu sampel setiap paling cepat 10 detik**, sehingga arsip tidak tumbuh setiap 3 detik. Ini adalah *sampling*, bukan rata-rata semua pembacaan selama 10 detik.

- **Riwayat live**: 120 pembacaan terbaru untuk dashboard dan analisis saat ini.
- **Arsip riset**: sampel asli tiap >=10 detik, disimpan paling lama **7×24 jam**. Kapasitas maksimal teoritis satu perangkat: **8.640 baris/hari atau 60.480 baris/7 hari** jika perangkat aktif tanpa jeda.
- **Auto-hapus di Redis**: setiap sampel baru menghapus rekaman yang usianya melewati 7 hari menggunakan sorted-set score. Arsip juga diberi TTL 7 hari dan akan dihapus oleh Redis walaupun ESP berhenti total.
- **Saat lokal tanpa Redis**: file `.local-data/telemetry-7days.jsonl` menyimpan arsip; rekaman kedaluwarsa tidak ditampilkan dan file dikompaksi paling lama setiap satu jam ketika masih ada kiriman baru. Jika komputer/server mati dan tidak menerima data, penghapusan fisik lokal terjadi pada kiriman berikutnya. File diabaikan Git.
- **Riwayat → Rentang**: pilih 1–7 hari terakhir atau dua tanggal (termasuk rentang 1–2 hari), maksimal 7×24 jam dan tidak bisa membaca data lebih dari 7 hari lalu. Grafik dibatasi **300 titik** yang mewakili sampel terakhir tiap bucket; jumlah rekaman asli ditampilkan terpisah.
- **Admin → Download CSV / Excel**: CSV UTF-8 siap dibuka Microsoft Excel maupun diolah menggunakan Python/pandas. CSV berisi **semua sampel mentah** dalam rentang yang dipilih, tidak dibatasi 300 titik. Saat ini **belum membuat file .xlsx native**. Operator boleh melihat grafik dan jumlah data tetapi tidak dapat mengunduh CSV.
- API: `GET /api/history?days=1..7`, `GET /api/history?from=<UTC-ISO>&to=<UTC-ISO>` (Admin & Operator), dan `GET /api/history/export?... ` (Admin saja). Semua endpoint memerlukan sesi aktif, tanpa cache, dan menerapkan batas maksimal 7 hari di server.

**Penting:** menyimpan histori tiap 10 detik bukan berarti mengurangi jumlah HTTP POST dari ESP yang masih tiap 3 detik. Jika butuh penghematan request hosting, cadence pengiriman ESP juga bisa dikurangi nanti, tetapi ambang OFFLINE 15 detik wajib disesuaikan. Tidak ada histori yang dapat direkonstruksi sebelum fitur arsip ini diaktifkan.

## Status OFFLINE telemetry (ESP32 tidak mengirim)

Dengan interval pengiriman ESP32 **3 detik**, dashboard memperlakukan data sebagai **OFFLINE** apabila pembacaan terbaru sudah melewati **15 detik** (sekitar lima siklus kirim yang terlewat), atau API tidak dapat dihubungi. Status dicek ulang oleh browser setiap 5 detik.

Ketika OFFLINE, status proses pembakaran serta seluruh kartu parameter (termasuk prediksi furan) diberi **aksen kuning/amber** dan label OFFLINE. Angka terakhir tetap terlihat sebagai **data historis, bukan nilai live**; prediksi furan dan peringatan berbasis data terkini tidak dilanjutkan sampai kiriman baru diterima. Bila ESP mengirim ulang, warna normal dan analisis live kembali otomatis. Jika belum pernah ada data sama sekali, tampilan awal tetap **MENUNGGU DATA SENSOR** tanpa mengarang nilai.

Untuk menguji: jalankan ESP sender sampai grafik muncul, matikan ESP32 selama sekitar 15–20 detik, lalu amati perubahan ke kuning. Hidupkan ESP32 kembali; setelah kiriman HTTP 201 berikutnya, dashboard kembali ke status live.

## Tampilan operator dan arti warna

- Panel **Status proses pembakaran** dibuat kontras: **merah = sedang membakar** (suhu tungku mencapai ambang aktif), **hijau = tidak membakar** (suhu di bawah ambang aktif), **abu-abu = suhu tidak tersedia / data tidak terbaru**. Status ini menunjukkan *aktivitas* pembakaran, **bukan bahaya atau keamanan emisi**.
- Indikator risiko proses memiliki warna yang terpisah berdasarkan indeks LoT: **hijau NORMAL (0–24)**, **kuning WASPADA (25–49)**, **oranye BAHAYA (50–74)**, dan **merah KRITIS (75–100)**. Label tersebut hanya interpretasi indeks internal, bukan pengukuran furan/dioksin langsung.
- Pada Analisis AI, status pemantauan dibedakan berdasarkan apakah aturan LoT menemukan pelampauan ambang internal: **NORMAL**, **WASPADA**, atau **BAHAYA**.
- Identitas teknis internal seperti kode perangkat tetap ada dalam payload/API untuk integrasi, sedangkan antarmuka menggunakan bahasa awam: **Alat pengirim data**, **Sensor gas**, **Penyimpanan data**.
- Informasi Hibah Bestari dan LPDP berada di bagian bawah halaman, bersama hak cipta dan identitas Omah Inovasi Universitas Ahmad Dahlan.

## Identitas visual\n\n- Logo ADI menggunakan ikon dari aset identitas yang diberikan; disimpan dalam `public/adi-logo.png` dan digunakan di sidebar, login, serta header mobile.\n- Ikon aplikasi persegi di `public/adi-icon.png` digunakan sebagai favicon/bookmark.\n- Logo memakai `object-fit: contain` agar tidak terpotong; ketika sidebar tersembunyi di ponsel, identitas tetap terlihat di atas Beranda.\n- Latar emblem dibuat terang supaya logo hijau tua tetap terbaca baik pada tema gelap maupun terang.\n\n## Dua jenis akun: Admin dan Operator

**Satu halaman login** di `/login` menerima Admin utama dan Operator yang dibuat oleh Admin.

- **Admin** (akun pemilik dari `ADMIN_USERNAME` / `ADMIN_PASSWORD` di `.env.local`) masuk ke `/admin`. Menu **Manajemen Pengguna** memungkinkan membuat akun Operator, mengaktifkan/menonaktifkan, dan reset password. Menu **Pengaturan** menyimpan ambang LoT di server dan berlaku untuk semua Operator.
- **Operator / User** masuk ke `/dashboard` dan hanya dapat membaca Beranda, Riwayat, Analisis AI, Peringatan, dan Perangkat. Tidak ada menu Pengaturan maupun Manajemen Pengguna. Akses tulis dicegah di **API server**, bukan hanya UI.
- Kedua halaman menampilkan badge hak akses (**ADMIN** atau **USER / OPERATOR**). Tidak ada registrasi publik.
- Password Operator disimpan sebagai hash **scrypt bersalt acak**, tidak pernah dikirim kembali oleh API. Menonaktifkan akun atau reset password menaikkan versi sesi, sehingga sesi Operator lama langsung ditolak pada permintaan berikutnya.
- Untuk **pengembangan lokal** tanpa Redis, akun serta ambang tersimpan dalam `.local-data/` (sudah diabaikan Git); data tetap ada setelah Next.js restart. Hati-hati bila folder proyek berada di OneDrive: file lokal itu mengandung hash akun dan sebaiknya tidak dibagikan.
- Untuk **production/staging**, Redis REST wajib dikonfigurasi melalui `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`. Akun Operator dan ambang tersimpan secara persisten di Redis.
- Admin utama tetap menggunakan `.env.local` / environment hosting; UI hanya mengelola Operator, bukan akun Admin utama. Sebelum multiadmin/MFA/akun email, sistem ini diperuntukkan bagi lingkungan terbatas.

### Uji alur akun

1. Login sebagai Admin, buka tab **Manajemen Pengguna**.
2. Buat `operator01` dengan password kuat (minimal 12 karakter, tidak menggunakan password umum).
3. Buka jendela Incognito/Private lalu login `operator01`. Pastikan badge **USER / OPERATOR** muncul dan menu Pengaturan/Pengguna tidak ada.
4. Ubah ambang melalui Admin; Operator akan memakai konfigurasi baru (polling setiap 30 detik).
5. Reset password/nonaktifkan Operator melalui Admin; sesi Operator sebelumnya wajib kehilangan akses, termasuk API telemetry.
6. Pengujian otomatis end-to-end: `npm run build` lalu `npm run test:auth`.

## Keamanan akses dashboard

Dashboard kini **khusus pengguna yang terautentikasi**. Halaman `/` mengarahkan Admin ke `/admin` dan Operator ke `/dashboard`, sedangkan pengguna tanpa sesi sah diarahkan ke `/login`. Server memeriksa cookie HMAC-SHA256 serta status aktif akun Operator.

- Cookie admin bersifat **HttpOnly**, **SameSite=Strict**, dan **Secure** pada HTTPS produksi. Sesi saat ini berlaku sampai 12 jam.
- Selama sesi masih sah, pengguna memang tidak perlu memasukkan kata sandi lagi setiap membuka halaman. Gunakan tombol **Keluar** untuk mengakhiri sesi di browser.
- `GET /api/telemetry` dilindungi login. `POST /api/telemetry` tetap menggunakan token terpisah `TELEMETRY_INGEST_KEY` untuk perangkat ESP.
- Tanggapan privat menggunakan **no-store** dan halaman yang dipulihkan lewat tombol Back diperiksa ulang.
- Mengganti `SESSION_SECRET` lalu memulai ulang server membatalkan semua sesi lama.
- Setelah build, jalankan `npm run test:auth` untuk pengujian integrasi halaman publik/privat, cookie rusak, password salah, endpoint telemetry, dan logout.

### Penguatan login sebelum staging

Login kini dibatasi maksimum **8 percobaan per akun per 15 menit**, ditambah maksimum **60 percobaan per sumber jaringan per 15 menit**. Pembatasan memakai Redis REST (skrip EVAL atomik) di produksi, dan memori sementara hanya saat `npm run dev` untuk pengujian lokal. Jika Redis tidak tersedia pada server produksi, login mengembalikan **503** (tidak menurunkan keamanan menjadi limiter RAM). Saat diblokir, API menjawab **HTTP 429** dengan header `Retry-After`.

Pemeriksaan IP hanya menggunakan alamat yang disediakan dan dinormalisasi oleh Vercel ketika `VERCEL=1`. Pada hosting lain tanpa proxy tepercaya, permintaan masuk ke bucket jaringan bersama sebagai batas tambahan; **jangan mempercayai header IP yang dikirim langsung oleh client**.

- `POST /api/login` dan `POST /api/logout` memeriksa `Origin` dan `Sec-Fetch-Site` bila tersedia; cookie tetap **HttpOnly**, **SameSite=Strict**, dan **Secure** pada produksi.
- Token sesi baru berisi subject, role `admin`, waktu terbit, expiry, dan ID acak, semuanya ditandatangani. Token versi lama otomatis tidak diterima; pengguna perlu login kembali.
- Route `/admin` dan pembacaan telemetry masih **khusus admin**, juga ditegakkan di backend. Role `operator` sudah aktif melalui akun yang dibuat Admin, dengan izin baca-saja.
- Tidak ada tombol registrasi terbuka. Saat database akun disiapkan, admin akan **mengundang/membuat pengguna**; operator hanya boleh memantau, tidak mengubah ambang atau konfigurasi.
- `npm run test:auth` memverifikasi login salah/benar, token rusak, role operator tidak bisa mengakses admin, pemblokiran login, CSRF, dan logout.

**Sebelum deploy publik:** tetap perlu pembatasan endpoint ingest perangkat, logging/audit akses, monitoring kegagalan, MFA bila dibutuhkan, revoke sesi server-side, penguatan hosting, serta pengujian keamanan independen. Logout saat ini menghapus cookie perangkat, tetapi token yang sudah dicuri masih valid sampai kedaluwarsa atau `SESSION_SECRET` diganti.

## Halaman login pengelola

Halaman `/login` memakai layout **split-screen industrial modern**: panel kiri **bright hijau muda** dengan ilustrasi incinerator dari gambar yang diberikan (aset `public/incinerator-illustration.png`, PNG transparan yang dioptimalkan dari gambar terbaru), panel kanan berisi formulir masuk. Pada ponsel login menjadi satu kolom dengan logo dan formulir agar tetap mudah digunakan.

Dashboard sekarang **default light/bright** pada kunjungan pertama. Tombol tema tetap memungkinkan pengguna memilih dark mode dan menyimpan pilihan baru pada browser. Preferensi lama yang tersimpan saat dark masih menjadi default tidak lagi dipaksakan.

Logo memakai aset `/adi-logo.png`; tidak ada data sensor fiktif yang ditampilkan pada halaman login. Kontrol tampil/sembunyikan kata sandi hanya mengubah visibilitas input. Endpoint autentikasi `POST /api/login`, cookie sesi admin, dan tujuan `/admin` **tidak diubah**. Pengelola tetap harus mengisi kredensial dan `SESSION_SECRET` yang kuat di server.

## Tampilan dan fungsi

- Nuansa **hijau lingkungan** dengan komposisi industrial telemetry dan font Barlow, Barlow Condensed, IBM Plex Mono.
- Beranda: status pembakaran, suhu tungku, suhu cerobong, CO, VOC, dan **Prediksi Risiko Furan** dengan label **Hasil Analisis AI**.
- Parameter tambahan: suhu lingkungan, kelembapan, H₂, dan indikator asap (hanya muncul angkanya jika dikirim sensor).
- Riwayat: suhu, gas, dan grafik prediksi risiko furan; arsip sampel tiap 10 detik dengan retensi otomatis maksimal 7 hari, pilihan rentang tanggal, dan CSV khusus Admin.
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

Masuk melalui `http://localhost:3000/login`. Pengunjung tanpa sesi sah yang membuka `/` atau `/admin` diarahkan ke halaman login. Tidak ada halaman pemantauan umum.


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

- **Hentikan sender:** tekan `Ctrl+C` di Terminal 2. Pembacaan terakhir akan menjadi kedaluwarsa setelah sekitar 15 detik, dan analisis otomatis berhenti.
- **URL lain:** `npm run sender:virtual -- --url https://domainmu.id/api/telemetry`. Pengiriman non-lokal wajib HTTPS; gunakan token ingest yang sesuai pada server tujuan. Jangan gunakan ini untuk mengirim data uji ke instalasi produksi sungguhan.
- **Sebelum ESP32 fisik dipasang:** matikan sender virtual, gunakan `deviceId` yang berbeda untuk perangkat asli, lalu kirim JSON dengan skema yang sama.
- **Uji program sender:** `npm run test:sender` (Node.js 22).

## Mengirim data dari ESP/gateway

Endpoint:
- `POST /api/telemetry` untuk ESP/gateway, wajib header `Authorization: Bearer <TELEMETRY_INGEST_KEY>`
- `GET /api/telemetry` untuk Admin atau Operator dengan sesi yang sah; tanpa login mengembalikan HTTP 401. Respons memuat `latest`, `history`, dan `storageReady`.

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
