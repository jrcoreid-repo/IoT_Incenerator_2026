# Panduan deployment bertahap — ADI Smart Incinerator

**Status:** persiapan untuk **staging/riser**. File ini bukan bukti web sudah online. Sensor fisik boleh belum lengkap; `furnace`, `stack`, `ambient`, `humidity`, `co`, `h2`, `voc`, `smoke` bisa `null`/tidak dikirim (minimal satu nilai numerik). Data dummy tidak boleh diperlakukan sebagai pengukuran emisi.

## Pilihan arsitektur

Untuk tahap awal, gunakan:
- **Dashboard/API:** hosting Next.js dengan HTTPS (contoh: Vercel Preview atau server Node.js).
- **Database:** Upstash Redis REST untuk data terbaru dan 120 pembacaan terakhir.
- **ESP32:** tetap mengirim ke server lokal sewaktu riset sensor. Baru setelah firmware mendukung **HTTPS dengan verifikasi sertifikat** boleh mengganti endpoint ke domain online.
- **Hak akses:** semua dashboard membutuhkan sesi admin; POST telemetry membutuhkan token perangkat.

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
6. Jangan membuat deployment production final sampai pengujian keamanan dan pembatasan login dipenuhi.

**Penting:** ketentuan Vercel Hobby adalah pemakaian personal nonkomersial. Untuk layanan proyek universitas/operasional tim, pastikan plan/izin sesuai atau gunakan infrastruktur universitas/VPS dengan biaya dan pengelolaan yang jelas.

Alternatif jika beban 24/7: **VPS / server kampus** (Next.js server Node.js dengan reverse proxy HTTPS + Redis/persistence). Lebih fleksibel untuk pengiriman kontinu, tetapi memerlukan backup, monitoring, update keamanan, dan operator server.

## 2. Siapkan Redis staging

Buat database REST Redis di Upstash, pilih region terdekat yang tersedia bagi pengguna/hosting. Salin `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` ke environment server hosting, **bukan ke source GitHub, firmware, atau frontend**.

Pada production, API POST tidak akan menerima telemetry jika Redis belum dikonfigurasi. Riwayat saat ini hanya **120 pembacaan terbaru**: jika interval 3 detik, rentangnya sekitar **6 menit**. Redis tidak menggantikan database historis jangka panjang; ekspor/penyimpanan analitik perlu dirancang terpisah.

### Perkiraan kuota dan biaya

Perangkat 3 detik, 24 jam:
- `30 hari × 24 × 3600 ÷ 3 = 864.000` POST per bulan.
- Kode saat ini melakukan **3 Redis command** per POST (`SET`, `LPUSH`, `LTRIM`), atau sekitar **2.592.000 command/bulan** belum termasuk pembacaan dashboard.
- Dashboard 1 browser yang dibuka terus menerus, polling tiap 5 detik, menambah sekitar **518.400 GET Redis/bulan** dan fungsi HTTP hosting. Beberapa browser menambah beban.
- Jadi free tier Upstash **500.000 commands/bulan** tidak cocok untuk 3 detik nonstop.
- Vercel Hobby mencantumkan **1 juta Function Invocations/bulan** (lihat ketentuan terbaru). POST+GET nonstop dari satu dashboard bisa melewati angka ini.

**Saran riset/staging:** aktifkan ESP dummy sesuai sesi uji, **tidak 24/7**, atau set interval 15–30 detik setelah pengujian real-time selesai. Bandingkan kuota/biaya aktual dan atur notifikasi biaya sebelum online terus menerus.

Sumber referensi:
- https://upstash.com/pricing/redis
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/deployments/environments

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

## 4. Verifikasi staging online

1. Akses URL Preview lewat browser dengan deployment protection aktif.
2. `/login` menampilkan form. `/admin` tanpa login harus dialihkan ke login.
3. Setelah login admin, dashboard muncul. Logout menghapus akses pada browser.
4. `GET /api/telemetry` tanpa sesi wajib `401`.
5. `POST /api/telemetry` tanpa token harus `401`; dengan token staging dan JSON valid harus `201`.
6. Pantau *database*, *function invocation*, error rate, dan ukuran data Redis. Uji data melewati batas 90 detik untuk melihat status stale.
7. Kirim data test lewat **Node.js virtual sender** dari laptop dengan URL HTTPS staging dan token staging (lihat README). Jangan mengubah firmware HTTP lokal untuk langsung mengarah ke internet.
8. Jangan mengklaim angka dummy sebagai data sensor; dokumentasikan setiap sesi uji.

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
- [ ] Rate limiting terpusat untuk login dan endpoint ingest; proteksi brute force dan audit login.
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
