# Panduan deployment bertahap — ADI Smart Incinerator

**Status:** persiapan untuk **staging/riser**. File ini bukan bukti web sudah online. Sensor fisik boleh belum lengkap; `furnace`, `stack`, `ambient`, `humidity`, `co`, `h2`, `voc`, `smoke` bisa `null`/tidak dikirim (minimal satu nilai numerik). Data dummy tidak boleh diperlakukan sebagai pengukuran emisi.

## Pilihan arsitektur

Untuk tahap awal, gunakan:
- **Dashboard/API:** hosting Next.js dengan HTTPS (contoh: Vercel Preview atau server Node.js).
- **Database:** Upstash Redis REST untuk 120 pembacaan live, arsip 10 detik selama maksimal 7 hari, akun Operator, pengaturan ambang, dan rate limiting login.
- **ESP32:** tetap mengirim ke server lokal sewaktu riset sensor. Baru setelah firmware mendukung **HTTPS dengan verifikasi sertifikat** boleh mengganti endpoint ke domain online.
- **Hak akses:** Admin ke /admin (termasuk ekspor CSV dan pengaturan); Operator ke /dashboard (hanya monitoring). POST telemetry membutuhkan token perangkat.

Alur:
```
ESP32 (LAN / riset) ── HTTP ──> Next.js lokal
                                   |
Laptop test sender -- HTTPS --> Next.js staging (login privat)
                                   |
                              Upstash Redis (STAGING)
                                   |
                            Browser admin via HTTPS
```

**Tidak perlu membeli domain sekarang.** Vercel menyediakan URL otomatis `*.vercel.app`; custom domain bisa ditambahkan setelah staging stabil. Gunakan lingkungan Preview terpisah sebelum production.

## 1. Tentukan hosting dan buat staging terproteksi

**Contoh Vercel** (hanya jika plan & ketentuan penggunaan sesuai):
1. Hubungkan GitHub repo `jrcoreid-repo/IoT_Incenerator_2026` ke proyek Vercel.
2. Pilih framework **Next.js** dan root direktori repository (project web berada di root).
3. **Perhatikan branch:** kode aktif berada di `design/minimal-operator-2026`. Branch default `main` bukan aplikasi terkini; jangan deploy `main` tanpa pengecekan.
4. Gunakan deployment **Preview** dari branch tersebut untuk testing; aktifkan **Vercel Authentication / deployment protection** agar URL preview tidak dapat diakses sembarang orang. Konfigurasikan akses anggota tim yang memang perlu menguji.
5. Jangan gunakan penyimpanan sensor/proxy demo yang sama dengan produksi. Buat Redis staging khusus dan token staging baru.
6. Login sekarang memiliki pembatasan terpusat Redis; **jangan membuat deployment production final** sampai konfigurasi Redis, pengujian keamanan, pembatasan ingest perangkat, dan perlindungan jaringan (WAF) diverifikasi.

**Penting:** ketentuan Vercel Hobby adalah pemakaian personal nonkomersial. Untuk layanan proyek universitas/operasional tim, pastikan plan/izin sesuai atau gunakan infrastruktur universitas/VPS dengan biaya dan pengelolaan yang jelas.

Alternatif jika beban 24/7: **VPS / server kampus** (Next.js server Node.js dengan reverse proxy HTTPS + Redis/persistence). Lebih fleksibel untuk pengiriman kontinu, tetapi memerlukan backup, monitoring, update keamanan, dan operator server.

## 2. Siapkan Redis staging

Buat database REST Redis di Upstash, pilih region terdekat yang tersedia bagi pengguna/hosting. Salin `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` ke environment server hosting, **bukan ke source GitHub, firmware, atau frontend**.

Pada production, API POST tidak akan menerima telemetry jika Redis belum dikonfigurasi. Dua lapisan data sekarang aktif: **120 pembacaan live terakhir**, serta **arsip riset 10 detik yang bergulir maksimal 7 hari** (60.480 rekaman untuk satu perangkat bila logging berlangsung 24/7). Arsip memakai Redis Sorted Set: setiap sampel baru menghapus data yang lebih tua dari 7 hari; TTL 7 hari akan menghapus seluruh arsip ketika perangkat tidak aktif lagi. Riwayat di luar 7 hari **tidak tersedia** dan CSV harus diunduh sebelum kedaluwarsa jika ingin menyimpan arsip penelitian lebih lama.

### Perkiraan kuota dan biaya

Perangkat 10 detik, 24 jam:
- `30 hari × 24 × 3600 ÷ 10 = 259.200` POST per bulan.
- Kode sekarang memakai satu request Redis REST **EVAL** atomik tiap POST untuk memperbarui live dan memeriksa apakah sudah waktunya mengarsip sampel 10 detik. Operasi internal Lua dan pembacaan tetap menggunakan sumber daya Redis; jangan menganggap satu EVAL selalu berarti satu unit biaya. Periksa metrik/billing aktual Upstash saat staging.
- Dashboard 1 browser yang dibuka terus menerus, polling tiap 5 detik, menambah sekitar **518.400 GET Redis/bulan** dan fungsi HTTP hosting. Beberapa browser menambah beban.
- Pada interval 10 detik, pengirim membuat sekitar **8.640 POST/hari** atau **259.200 POST per 30 hari** untuk satu perangkat nonstop. Ini belum termasuk polling dashboard dan biaya operasi database; kuota layanan harus diperiksa sebelum operasi 24/7.
- Vercel Hobby mencantumkan **1 juta Function Invocations/bulan** (lihat ketentuan terbaru). POST+GET nonstop dari satu dashboard bisa melewati angka ini.

**Saran riset/staging:** aktifkan ESP dummy sesuai sesi uji, **tidak 24/7** pada tahap awal. Bandingkan kuota/biaya aktual dan atur notifikasi biaya sebelum online terus menerus.

Sumber referensi:
- https://upstash.com/pricing/redis
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/deployments/environments

### Pengujian arsip saat staging

- Login Admin → **Riwayat**; pilih 1, 2, ... 7 hari atau dua tanggal dan tekan Download CSV / Excel. Untuk ekspor riwayat lengkap, CSV kompatibel Excel digunakan, **belum tersedia file .xlsx native**.
- Uji GET `/api/history?days=7` dengan cookie Admin/Operator, pastikan respons grafik maksimal 300 titik dan jumlah baris asli dihitung terpisah.
- Uji GET `/api/history/export?days=2`: Admin memperoleh berkas CSV UTF-8, Operator mendapat **403**, pengunjung tidak login mendapat **401**.
- `days=8` atau rentang tanggal lebih dari 7 hari harus ditolak **400**. Pembacaan lebih dari 7 hari lalu tidak dikembalikan.
- Arsip dimulai setelah fitur ini dipasang; pembacaan sebelum deploy **tidak di-backfill**. Simulasi lokal memakai `.local-data/telemetry-7days.jsonl`; untuk staging dan production Redis wajib aktif.
- Jangan mengaktifkan pengiriman 10 detik 24/7 tanpa memastikan kapasitas dan anggaran database maupun fungsi hosting. Pengaturan terbaru mengubah **keduanya**: interval pengiriman ESP dan interval pencatatan histori menjadi 10 detik.

## 3. Konfigurasi environment di hosting

Buat environment variables di panel Vercel / host, dengan nilai asli yang kuat dan **berbeda** dari lokal maupun produksi lain:

```dotenv
ADMIN_USERNAME=<USERNAME_UNIK>
ADMIN_PASSWORD=<PASSWORD_KUAT_MIN_12_KARAKTER>
SESSION_SECRET=<RAHASIA_ACAK_MIN_32_KARAKTER>
TELEMETRY_INGEST_KEY=<TOKEN_ESP_MIN_24_KARAKTER>
UPSTASH_REDIS_REST_URL=<URL_HTTPS_REDIS>
UPSTASH_REDIS_REST_TOKEN=<TOKEN_REDIS_PRIVAT>
```

Gunakan variabel **Preview** untuk staging; saat membuat Production gunakan set baru agar data dan hak akses terpisah. Jangan unggah `.env.local`, `config.h`, atau password/tokens ke GitHub, screenshot, ataupun log.

Jika ingin mengecek file environment di PC tanpa mencetak rahasia:

```cmd
npm run deploy:check
```

atau, untuk file **lokal yang tidak di-commit**:

```cmd
npm run deploy:check -- --env-file .env.deploy.local
```

File ini hanya memeriksa **kelengkapan dan format dasar**, bukan menguji koneksi asli atau keamanan penuh.

## Pengamanan login saat staging

- Login admin menggunakan HMAC-SHA256 dengan identitas dan role yang ditandatangani. Format cookie versi lama tidak lagi diterima: masuk kembali sesudah deploy.
- Redis untuk **login throttling** wajib tersedia pada `NODE_ENV=production`. Tanpa Redis atau ketika Redis tidak dapat dihubungi, `POST /api/login` mengembalikan **503**, bukan mengizinkan login tanpa rate limit. Ini berarti `npm run start` juga memerlukan Redis, sedangkan `npm run dev` tetap bisa diuji secara lokal dengan memori sementara.
- Setelah 8 percobaan login per akun dalam 15 menit, login diblokir (HTTP 429). Batas tambahan jaringan adalah 60 percobaan per 15 menit; IP asli hanya dipercaya pada Vercel yang menormalkan header dan ketika `VERCEL=1`. Pengguna bisa terkena pembatasan jika tes login salah berulang kali.
- Browser diberi cookie `HttpOnly`, `SameSite=Strict`, `Secure` pada produksi. POST login/logout memeriksa origin/fetch metadata.
- `GET /api/telemetry` dan `/admin` masih khusus admin. **Belum ada user-management atau self-registration.** Ketika multi-user aktif, admin mengundang akun dan operator mendapat akses baca saja, ditegakkan pada endpoint server.
- Masih harus disiapkan sebelum akses publik luas: MFA, audit login terpusat, pembatasan ingest perangkat, penanganan recovery akun, revokasi sesi saat logout (sesi sekarang stateless), monitoring serangan dan WAF.

Referensi: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

## 4. Verifikasi staging online

1. Akses URL Preview lewat browser dengan deployment protection aktif.
2. `/login` menampilkan form. `/admin` tanpa login harus dialihkan ke login.
3. Setelah login admin, dashboard muncul. Logout menghapus akses pada browser.
4. `GET /api/telemetry` tanpa sesi wajib `401`.
5. `POST /api/telemetry` tanpa token harus `401`; dengan token staging dan JSON valid harus `201`.
6. Pantau *database*, *function invocation*, error rate, dan ukuran data Redis. Uji data melewati batas 35 detik untuk melihat status stale.
7. Kirim data test lewat **Node.js virtual sender** dari laptop dengan URL HTTPS staging dan token staging. Jika preview dilindungi Vercel Authentication, pengirim HTTP otomatis juga memerlukan **Protection Bypass for Automation** terpisah, karena Vercel memblokir request otomatis sebelum mencapai API Next.js.
8. Jangan mengklaim angka dummy sebagai data sensor; dokumentasikan setiap sesi uji.

### Menguji staging yang dilindungi Vercel Authentication

Buat secret **Protection Bypass for Automation** pada pengaturan Deployment Protection Vercel. Secret ini **berbeda** dari `TELEMETRY_INGEST_KEY` dan tidak mengganti validasi token perangkat di Next.js. Jangan simpan bypass secret di GitHub atau firmware; ia hanya diperlukan pada alat uji staging.

Di PowerShell pada laptop, untuk **pengujian terbatas** (ganti URL dengan preview milikmu):

```powershell
$env:TELEMETRY_INGEST_KEY = Read-Host "Token ingest STAGING"
$env:VERCEL_AUTOMATION_BYPASS_SECRET = Read-Host "Vercel bypass STAGING"
npm run sender:virtual -- --url https://NAMA-PREVIEW.vercel.app/api/telemetry --scenario cycle --interval 15 --count 12
Remove-Item Env:TELEMETRY_INGEST_KEY
Remove-Item Env:VERCEL_AUTOMATION_BYPASS_SECRET
```

Sender hanya melampirkan `x-vercel-protection-bypass` jika URL adalah **HTTPS** dan hostname berakhiran **.vercel.app**. Bypass tidak dikirim ke localhost/URL non-Vercel. Jika kamu menggunakan domain khusus dengan proteksi yang sama, lakukan pengujian manual memakai header yang tepat (lihat dokumentasi Vercel). Bypass merupakan akses tingkat hosting yang sensitif; **jangan gunakan di firmware produksi**.

Referensi: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation

Contoh uji via PowerShell (isi token staging pribadi tanpa menaruhnya dalam source):

```powershell
$token = Read-Host "TELEMETRY_INGEST_KEY staging"
$payload = @{ deviceId = "ESP32-VIRTUAL-STAGING"; furnace = 100; stack = 70; co = 12; voc = 20 } | ConvertTo-Json
Invoke-RestMethod -Uri "https://URL-STAGING/api/telemetry" -Method Post -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -Body $payload
```

**Jangan gunakan nilai environment production untuk staging.** Sebelum koneksi sensor RS485 asli, validasi skala, kalibrasi, validitas data dan unit fisik.

## 5. Kriteria sebelum produksi terbuka

- [ ] Hosting & lisensi/plan layak untuk proyek universitas.
- [ ] HTTPS dan konfigurasi DNS/sertifikat benar.
- [x] Rate limiting Redis untuk login admin dan mitigasi percobaan password berulang; [ ] rate limiting endpoint ingest, monitoring kegagalan, audit login, serta WAF.
- [ ] Kredensial acak kuat dan terpisah antar environment; proses rotasi token siap.
- [ ] Redis/DB persisten, backup, retensi historis dan monitor biaya/kuota.
- [ ] Pengaturan ambang LoT saat ini **lokal di browser**; jika multioperator perlu disimpan dan divalidasi di server.
- [ ] Data dummy dan real diberi pembeda jelas.
- [ ] Error handling/retry/backoff ESP saat internet terganggu, Wi-Fi reconnect, jam/NTP dan HTTPS CA trust.
- [ ] Uji akses admin tanpa sesi, akses telemetry, login/logout, cache browser, serta pengujian keamanan terpisah.
- [ ] Prediksi risiko furan berbasis LoT **belum tervalidasi sebagai pengukuran emisi**; jangan jadikan dasar keselamatan/kepatuhan sebelum validasi ilmiah.

## Perintah yang sudah tersedia

```cmd
npm run test:sender
npm run build
npm run test:auth
npm run test:deploy
npm run deploy:check
```

Urutan evaluasi: build → pengujian akses → uji data staging → baru keputusan tentang server/domain/produksi.
