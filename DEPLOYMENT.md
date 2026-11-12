# Panduan deployment bertahap — ADI Smart Incinerator

**Status:** persiapan untuk **staging/riser**. File ini bukan bukti web sudah online. Sensor fisik boleh belum lengkap; `furnace`, `stack`, `ambient`, `humidity`, `co`, `h2`, `voc`, `smoke` bisa `null`/tidak dikirim (minimal satu nilai numerik). Data dummy tidak boleh diperlakukan sebagai pengukuran emisi.

## Persiapan revisi VPS existing — November 2026 (Caddy + Next.js)

**Konteks:** situs `https://adi-incinerator.live` telah berjalan melalui Caddy ke `127.0.0.1:3000`. Dokumen di bawah ini adalah runbook untuk memperbarui **instalasi VPS yang sudah ada**, bukan membuat staging Vercel baru. Target sumber kode adalah branch `design/minimal-operator-2026`, termasuk PNG desktop dan portrait, panel telemetry, serta simulator. **Jangan deploy branch `main` sebagai pengganti.**

**Pemisahan lingkungan:** laptop boleh mengirim simulasi ke `http://localhost:3000/api/telemetry`; **jangan pernah mengarahkan sender virtual ke domain produksi**. Tidak perlu mengubah firmware EG118 untuk rilis website. Jangan mengubah `TELEMETRY_INGEST_KEY`, `SESSION_SECRET`, akun, atau database produksi kecuali sedang menjalankan rotasi kredensial yang direncanakan.

### A. Audit VPS tanpa mengubah layanan (jalankan via SSH)

```bash
# Informasi versi Node.js (target Node 22) dan npm
node --version
npm --version

# Identifikasi service yang benar; tidak mengasumsikan nama systemd/PM2
systemctl list-units --type=service --all | grep -Ei 'adi|incinerator|next|caddy|redis' || true
pm2 list 2>/dev/null || true
sudo systemctl status caddy --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile

# Periksa reverse proxy lokal dan domain, tanpa mencetak kredensial
curl -I --max-time 10 http://127.0.0.1:3000/login
curl -I --max-time 10 https://adi-incinerator.live/login
```

Catat **nama unit atau proses aktual, user service, path working directory, lokasi environment, dan commit Git lama**. Jangan menebak nama unit `adi-incinerator` sebelum melihat hasilnya. Status `/login` harus dicek **bersama halaman HTML/redirect di browser**, bukan hanya mengandalkan HTTP 200/3xx karena middleware dapat mengarahkan sesi yang sudah login.

### B. Backup dan cek kesiapan data

1. Dokumentasikan commit Git produksi saat ini: dari direktori kerja aplikasi yang benar, jalankan `git status --short`, `git branch --show-current`, dan `git rev-parse HEAD`. **Jika ada perubahan lokal, jangan paksa reset/pull** sampai dianalisis.
2. Backup environment privat, konfigurasi Caddy/systemd, dan database Redis memakai metode backup server yang tersedia; batasi akses berkas rahasia. **Jangan commit, screenshot, atau kirim isi .env/token ke chat.**
3. Pastikan sumber penyimpanan produksi sama dengan sebelumnya: `REDIS_URL=redis://127.0.0.1:6379` **atau** `UPSTASH_REDIS_REST_URL` bersama `UPSTASH_REDIS_REST_TOKEN`. Jangan mengganti provider tanpa rencana migrasi akun, ambang, dan riwayat.
4. Redis menyimpan **akun Operator, pengaturan ambang, 120 data terbaru, arsip 7 hari, dan pembatasan login**; `npm run build` tidak seharusnya menghapus data ini, tetapi perubahan database/flush/recreate akan menghilangkannya. **Dilarang menjalankan `redis-cli FLUSHALL` atau `FLUSHDB`.**
5. Verifikasi token ingest server tidak berubah agar gateway fisik kelak tetap diterima. Pastikan Caddy dan firewall tidak mengekspos port 3000 maupun 6379 ke internet; Caddy meneruskan HTTPS ke loopback.

### C. Pengujian sebelum menyentuh aplikasi live (di laptop atau checkout terpisah)

```bash
git fetch origin design/minimal-operator-2026
git rev-parse origin/design/minimal-operator-2026
npm run test:sender
npm run test:deploy
npm run test:history
npm run build
npm run test:auth
```

`npm run test:auth` menjalankan **server uji pada port acak dengan mock Redis**, bukan untuk menulis telemetry produksi. Jangan menjalankannya ketika `npm run dev` memakai folder `.next` yang sama. Kalau proyek berada di folder sinkronisasi OneDrive dan terkena error `readlink EINVAL`, lakukan build di checkout lokal di luar OneDrive.

**Catatan reproduktibilitas:** repository saat ini belum memuat `package-lock.json`; pipeline memakai `npm install` alih-alih `npm ci`. Pertahankan versi Node yang cocok dan jalankan instalasi di checkout uji terpisah. **Jangan mengklaim hasil build/CI lulus sampai log eksekusi terverifikasi**. Rilis dapat ditunda bila audit dependensi, build, atau test gagal.

### D. Rilis terkontrol ke VPS

1. **Prioritaskan checkout/release directory terpisah** untuk `npm install` dan `npm run build`, bukan menimpa `.next` dari proses Next.js yang sedang melayani pengguna. Gunakan branch dan commit yang lolos pengujian; jangan membawa file .env/secrets ke Git.
2. Pastikan konfigurasi privat di release baru tersedia melalui mekanisme environment service yang sama dengan instalasi lama, tanpa mengubah nilainya. Cek `npm run deploy:check` dengan environment produksi **tanpa mencetak token**. Perintah ini hanya memeriksa bentuk konfigurasi, bukan konektivitas Redis.
3. Dalam jendela maintenance singkat, arahkan **service nyata yang sudah teridentifikasi pada langkah A** ke release yang telah dibuild; restart satu proses Next.js saja. **Jangan mengubah Caddyfile atau sertifikat kalau tidak diperlukan.**
4. Simpan release lama dan commit SHA sebagai target rollback. Jangan hapus database, environment, dan direktori live yang dipakai sebelumnya.
5. Jika proses restart gagal, kembalikan unit/path ke release lama dan restart ulang; jika hanya perubahan kode, rollback **tidak** perlu menghapus Redis. Dokumentasikan penyebab sebelum mencoba lagi.

**Perintah yang sensitif terhadap konfigurasi** (mengedit file service, `systemctl restart <nama-unit>`, `pm2 reload <nama-proses>`) sengaja tidak diberi nama fiktif. Gunakan hanya setelah output audit VPS menunjukkan nama dan lokasi yang benar.

### E. Smoke test setelah restart

- Pastikan `https://adi-incinerator.live/login` terbuka lewat HTTPS dengan sertifikat valid.
- Tanpa login, `/admin` harus dialihkan ke `/login`; setelah login admin, Beranda, Grafik, Analisis, Riwayat, dan Logout bekerja.
- Di HP, pastikan gambar `/incinerator-mobile.png`; pada desktop `/incinerator-v4.png`. Kedua file PNG harus HTTP 200, tidak ada request 404.
- Login akun Operator yang sudah ada (jika dipakai) dan pastikan hak akses serta ambang tersimpan. Cek riwayat lama masih tersedia sesuai masa retensi 7 hari.
- `GET /api/telemetry` tanpa cookie harus 401. `POST /api/telemetry` tanpa token harus 401. **Jangan mengirim payload virtual ke database produksi hanya untuk mengisi grafik.**
- Bila gateway asli belum mengirim, status **OFFLINE / MENUNGGU** adalah benar. Jangan menyimpulkan website rusak dari ketiadaan angka sensor.
- Periksa log service dan Caddy untuk error 5xx, serta ketahanan setelah restart. Jika ada kegagalan, lakukan rollback release kode dan ulang smoke test.

**Kriteria GO:** backup tervalidasi, commit target tercatat, test/build lulus, Redis tetap, service lama bisa dipulihkan, HTTPS/login tidak terbuka untuk publik tanpa autentikasi. **Status:** prosedur rilis sudah didokumentasikan; audit langsung VPS, backup, build pada host dan restart **belum dilaksanakan dari percakapan ini**.

---

## Pilihan arsitektur

Untuk tahap awal, gunakan:
- **Dashboard/API:** hosting Next.js dengan HTTPS (contoh: Vercel Preview atau server Node.js).
- **Database:** Upstash Redis REST untuk 120 pembacaan live, arsip 10 detik selama maksimal 7 hari, akun Operator, pengaturan ambang, dan rate limiting login.
- **ESP32:** tetap mengirim ke server lokal sewaktu riset sensor. Baru setelah firmware mendukung **HTTPS dengan verifikasi sertifikat** boleh mengganti endpoint ke domain online.
- **Hak akses:** Admin ke /admin, Operator ke /dashboard. **Keduanya dapat monitoring, analisis, memilih riwayat dan ekspor CSV**. Hanya Admin bisa mengubah ambang serta mengelola akun. POST telemetry membutuhkan token perangkat.

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

## Status preflight dan keputusan staging (9 November 2026)

- [x] Branch aplikasi yang benar: `design/minimal-operator-2026`; `main` masih default repo dan **bukan** rilis aplikasi terbaru.
- [x] Build dan tes integrasi Admin/Operator, akses data, logging 10 detik, retensi 7 hari, dan ekspor CSV lulus CI pada branch ini.
- [x] File lokal sensitif (`.env*`, `.local-data/`, firmware `config.h`) diabaikan Git, dengan lapisan `.vercelignore` tambahan untuk deploy via Vercel CLI.
- [ ] Buat proyek Vercel dari GitHub, **periksa branch yang di-deploy**. Jangan gunakan `main` lama sebagai produk terkini.
- [ ] Aktifkan perlindungan Vercel Authentication pada Preview dan siapkan Upstash Redis **khusus staging**.
- [ ] Simpan enam environment variables privat untuk Preview di Vercel; jangan membagikan `.env.local`/token ke chat.
- [ ] Uji deployment Preview dengan Admin dan Operator, riwayat dan ekspor CSV, reset/revoke akun, serta pemulihan data setelah redeploy.
- [ ] Kirim data dummy HTTPS menggunakan virtual sender + Vercel bypass (bila Preview dilindungi); firmware ESP32 fisik masih HTTP LAN, **belum siap** untuk HTTPS publik.
- [ ] Pantau biaya: 10 detik nonstop berarti ~259.200 POST/30 hari; 1 browser yang terus terbuka dengan polling 5 detik menambah ~518.400 GET/30 hari. Free Redis 500.000 commands/bulan berisiko tidak cukup untuk nonstop.
- [ ] Produksi setelah HTTPS perangkat terverifikasi, token dirotasi, retensi Redis sungguhan dan backup diuji, serta proteksi ingest/rate limit dan recovery disiapkan.

**Hak akses final:** Admin dan Operator boleh monitoring, analisis, riwayat 1–7 hari, dan unduh CSV; hanya Admin boleh mengubah pengaturan serta membuat/menonaktifkan/reset akun.

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

- Login sebagai Admin **atau Operator** → **Riwayat**; pilih 1, 2, ... 7 hari atau dua tanggal dan tekan Download CSV / Excel. Untuk ekspor riwayat lengkap, CSV kompatibel Excel digunakan, **belum tersedia file .xlsx native**.
- Uji GET `/api/history?days=7` dengan cookie Admin/Operator, pastikan respons grafik maksimal 300 titik dan jumlah baris asli dihitung terpisah.
- Uji GET `/api/history/export?days=2`: Admin **dan Operator aktif** memperoleh berkas CSV UTF-8 yang sama, pengunjung tidak login mendapat **401**. Akun Operator yang dinonaktifkan juga harus ditolak.
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
- `GET /api/telemetry`, `/api/history`, dan `/api/history/export` dapat diakses Admin dan Operator aktif. Hanya Admin dapat membuka `/admin`, mengubah `/api/thresholds` dan mengelola akun melalui `/api/users`. Tidak ada registrasi publik; Admin membuat dan mengelola akun Operator.
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
- [x] Pengaturan ambang LoT disimpan dan divalidasi **di server** (Redis di staging/production). Hanya Admin yang dapat mengubahnya; Operator memakai ambang bersama.
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
