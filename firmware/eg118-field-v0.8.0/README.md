# EG118 Field Firmware v0.8.0 — integrasi sensor nyata + telemetry

**Status: ENGINEERING CANDIDATE, belum di-compile/upload/diuji hardware pada EG118.** Kode dibangun dari snapshot read-only v0.7.4 yang sudah bekerja pada pengujian sensor sebelumnya. Jangan langsung menggantikan firmware lapangan sampai pengujian lengkap selesai. Tidak ada kontrol tungku/relay atau fungsi keselamatan proses.

## Keputusan mapping final (dikonfirmasi pemilik proyek)

**CH4 = CEROBONG (stack)**, **CH5 = TUNGKU (furnace)**. Register Ebyte ID2 FC04 0x0190 qty6, CH4 indeks register 3, CH5 indeks register 4, signed /10 °C. Bila channel disconnected (termasuk raw 0xFC19), keluaran JSON-nya `null`, bukan 0°C.

## Fitur baseline yang dipertahankan

- RS485 UART1 9600 8N1: TX32, RX33, DE12. Poll order ZEH100 ID1 FC03 0x0001 qty4 → CWT ID3 FC03 0x0000 qty2 → Ebyte ID2 FC04 0x0190 qty6. Poll nominal 3 detik, timeout Modbus 1200 ms, inter-sensor gap 250 ms, interbyte guard 45 ms, CRC16 verification.
- WORK/WDI **GPIO3 yang berbagi UART0 RX**. Tanpa Serial.begin. Timer independen 100 ms: BOOT 100/100 ms, NORMAL 100/900 ms, DEGRADED 100/300 ms (HIGH/LOW). Jangan hubungkan TX USB-TTL ke GPIO3 saat firmware berjalan. Indikator bukan watchdog bersertifikasi keselamatan.
- Wi-Fi SoftAP `JR-AIoT-DIAG`: halaman lokal `/` dan `/status`. Status JSON mengandung online/valid/warmup/errors, free heap, uptime, dan HTTP POST counters. Kata sandi AP disimpan hanya di `config.h` lokal.
- ZEH100 online ≠ data valid; frame seluruhnya nol = warmup-like; dua frame non-placeholder berturut-turut = valid menurut heuristik pengujian, **bukan READY resmi Winsen**. Flag bit alarm/fault butuh verifikasi dokumen vendor.

## Tambahan v0.8.0

- Mode **WIFI_AP_STA**: SoftAP diagnostik tetap aktif, STA mencoba sambung ulang tiap 10 detik tanpa restart.
- HTTP/HTTPS POST setiap sekitar 10 detik ketika Wi-Fi terhubung; bahkan bila semua pembacaan invalid, kirim `sensors` sebagai **status-only heartbeat** dengan nilai `null`.
- HTTPS hanya dengan CA roots `ca_roots.h` + sinkronisasi NTP, tanpa `setInsecure()`. HTTP biasa hanya diperbolehkan ke IP LAN privat (10/8, 172.16–31/12, 192.168/16); jangan untuk internet.
- POST menggunakan Bearer `TELEMETRY_INGEST_KEY` yang terpisah dari password admin. Bila jaringan gagal, baseline tetap polling dan mencoba lagi pada interval kirim berikutnya, tetapi **belum ada buffer offline** atau retry/backoff lanjutan.
- JSON status: `sensors.cwt`, `sensors.ebyte`, `sensors.zeh100`, `gasModuleC`, dan nilai sensor yang sudah disepakati API. `smoke: null` sebab bit alarm asap bukan nilai kuantitatif.
- **Sinkronisasi data bersifat push**, bukan polling server secara langsung ke perangkat. Browser membaca histori terakhir melalui `GET /api/telemetry`. Status "online" perangkat didasarkan pada heartbeat terakhir yang masih segar; jika internet down, pembacaan server akan ditandai stale.

## Cara uji lokal (hanya saat siap test)

1. Salin `config.example.h` menjadi **`config.h`** di folder sketch; isi SSID/password Wi-Fi, AP diagnostik (minimal 8 karakter), URL laptop seperti `http://192.168.1.10:3000/api/telemetry`, dan kunci ingest pribadi minimal 24 karakter. `config.h` sudah di-`.gitignore`.
2. Arduino IDE: ESP32 board core; pilih board EG118 sesuai jenis ESP32 fisik. **Jangan aktifkan Serial Monitor dengan USB-TTL TX terhubung ke GPIO3/RX0.**
3. Jalankan Next.js lokal `npm run dev -- -H 0.0.0.0` dengan `TELEMETRY_INGEST_KEY` sama. Matikan dummy sender agar data tidak bercampur.
4. Cek panel `JR-AIoT-DIAG` → `/status`: Modbus online, CH4/CH5 valid, ZEH warmup, `http_ok`, `http_errors`, dan `last_http_status`. Kiriman sukses memberi HTTP 201.
5. Simulasikan cabut Wi-Fi, reboot router, matikan Next.js, lepas termokopel (di kondisi aman), ZEH warmup, dan satu sensor RS485 offline. Verifikasi tidak muncul nilai 0 palsu, timer WDI tetap berpulsa, dan saat jaringan kembali perangkat mengirim lagi.

## Pembatas penting sebelum versi final

- `HTTPClient.POST()` **masih sinkron** (timeout di-set 1800 ms); timing polling 3 s bisa meleset ketika jaringan lambat. Timer WORK/WDI tetap berjalan secara terpisah. Untuk instalasi 24/7 sebaiknya pindahkan networking ke FreeRTOS task/queue agar polling tidak terhambat; ukur efeknya pada board nyata.
- Perlu verifikasi bahwa board mendukung GPIO3 untuk WDI, akses CA dan memory, dan bahwa SoftAP+STA bisa berjalan bersama di jaringan lapangan.
- Bukan implementasi command/control dari server; **tidak ada remote control aktuator**. Monitoring online 24/7 membutuhkan uplink Wi-Fi/router, server Next.js, dan Redis yang terus berjalan. Tidak ada perangkat yang dapat menjamin koneksi selalu tersedia ketika jaringan mati.
- CI Next.js hanya membangun/menguji aplikasi server, bukan mengompilasi Arduino ataupun memvalidasi hardware RS485/WDI.

