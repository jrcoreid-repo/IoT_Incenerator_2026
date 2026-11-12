# EG118 v0.7.4 — baseline komunikasi sensor dan WORK/WDI

Referensi **firmware yang diberikan pengguna, 11 November 2026**, disimpan sebagai snapshot untuk pengembangan firmware final ADI Smart Incinerator. Sumber: `eg118-reference-v0.7.4.ino`. Ini **bukan** firmware deployment produksi dan **belum** terhubung ke API Next.js. Firmware ini adalah server HTTP lokal melalui SoftAP.

> Perubahan dari teks sumber hanya **password SoftAP disamarkan**, agar tidak mempublikasikan kredensial aktif. Isi password sendiri sebelum flashing dan jangan commit kredensial sebenarnya. Semua operasi Modbus, timing, interpretasi sensor, dan pola pulsa dibiarkan mengikuti sumber pengguna.

## Topologi dan parameter wajib dipertahankan

| Sensor | Slave | Modbus | Start | Quantity | Interpretasi |
|---|---:|---|---|---:|---|
| Winsen ZEH100 | 1 | FC03 | `0x0001` | 4 | CO, H₂, VOC, suhu modul, flags dari 8 byte |
| CWT-TH01S | 3 | FC03 | `0x0000` | 2 | RH dan suhu lingkungan, skala /10 |
| Ebyte ME31-XEXX0600 | 2 | FC04 | `0x0190` | 6 | CH4 dan CH5 dari enam register; signed /10 |

**RS485**: UART1 **9600 8N1**, TX GPIO32, RX GPIO33, DE/RE GPIO12. Polling ZEH100 → delay 250 ms → CWT → delay 250 ms → Ebyte, setiap kira-kira 3 detik. Modbus timeout 1200 ms, guard inter-byte 45 ms, boot settle 5 detik. Mode transceiver untuk transmit HIGH lalu LOW untuk receive. Semua request **read-only**; tidak menulis register atau mengendalikan aktuator.

**Modbus frame**: CRC16 `0xA001`, verifikasi alamat, function code, panjang/byte count, pengecualian `fc | 0x80`, dan CRC pada satu frame respons. Jangan menurunkan timeout/guard tanpa mengulangi uji lapangan.

**CH4 dan CH5 belum memiliki mapping fisik final** ke tungku/cerobong. Firmware memvalidasi masing-masing channel dan menganggap `0xFC19` sebagai disconnected. Nilai yang tidak valid ditampilkan `null` / N/A, **bukan 0°C**. Jangan menetapkan `furnace`/`stack` sampai wiring dan label dikonfirmasi.

## Winsen ZEH100: state wajib dibawa ke API web

- `zeh.online`: transaksi Modbus berhasil (CRC valid); **tidak sama dengan gas siap ukur**.
- `zeh.data_valid`: dua frame non-placeholder **berturut-turut** setelah frame semua nol/putus; pengujian kestabilan sementara, **bukan flag READY resmi pabrikan**.
- `zeh.warmup_like`: frame respons 8 byte seluruhnya nol; indikasi startup/placeholder, **bukan bukti final warm-up**.
- `co_ppm`, `h2_ppm`, `voc_ppm`: dua byte big-endian masing-masing; dikirim hanya saat `data_valid=true`.
- `module_c`: `rx[9]-40` derajat Celsius; termasuk ketika gas belum siap, data UI tetap `null` menurut sumber.
- `flags`: `rx[10]` byte. Interpretasi **sementara** pada web diagnostik sumber: bit 0 CO alarm; 1 H₂ alarm; 2 VOC alarm; 3 smoke alarm; 4 temp alarm; 5 CO fault; 6 H₂ fault; 7 VOC fault. **Konfirmasi dengan dokumen register Winsen dan pengujian** sebelum digunakan sebagai alarm keselamatan.
- Reset counter `gasReadyFrames` bila frame all-zero atau transaksi gagal. `gasDataValid` dipisah dari `zeh.online`.

**Tidak tersedia dari sumber**: pengukuran numerik asap dB/m. Jangan mengisi field `smoke` dengan angka rekaan dari alarm bit.

## Diagnostik perangkat / fault

Firmware lokal menyajikan `GET /status` dengan struktur `cwt`, `ebyte`, dan `zeh100`, serta `uptime_s`, `boot_reason`, `free_heap`, `polls`, `led_mode`. Tiap perangkat punya `online`, `ok`, `errors`; Ebyte punya `ch4_connected` dan `ch5_connected`. **Pastikan ini tidak terbuang saat mengadaptasi ke JSON telemetry baru**, termasuk saat seluruh nilai sensor `null` (status-only heartbeat).

Suhu dan RH yang gagal divalidasi menjadi `NAN` secara internal dan `null` di JSON. Frame Ebyte yang CRC valid belum tentu berarti probes CH4/CH5 terhubung.

## WORK/WDI — sangat penting untuk perangkat lapangan

`WORK_WDI=GPIO3` dipakai bersama **UART0 RX**. **JANGAN sambungkan TX USB-TTL ke GPIO3/RX0 saat menjalankan firmware ini**. Firmware sengaja tidak menggunakan `Serial.begin()`/debug serial.

Pulse generator menggunakan `esp_timer` callback setiap **100 ms**, lalu `gpio_set_level`. Pola:

| Mode | HIGH | LOW | Periode transisi HIGH → LOW |
|---|---|---|---|
| BOOT (mode 0) | 100 ms | 100 ms | 200 ms |
| NORMAL (mode 1) | 100 ms | 900 ms | 1000 ms |
| DEGRADED (mode 2) | 100 ms | 300 ms | 400 ms |

Mode **NORMAL** jika CWT, Ebyte, ZEH online, CH4/CH5 valid, gas `data_valid`, dan `gasFlags==0`; selain itu DEGRADED. Pulsa tetap berjalan dalam semua mode. **Bukan safety-rated watchdog**; jangan menafsirkan mode normal sebagai validasi keselamatan proses pembakaran.

## Server lokal diagnostic

- `WiFi.mode(WIFI_AP)`, `WiFi.softAP`, SSID `JR-AIoT-DIAG`, password dalam repository sudah diganti placeholder.
- HTTP port 80, `GET /` untuk halaman ringkas, `GET /status` untuk JSON tanpa cache, refresh browser setiap 2 detik.
- Tidak ada koneksi STA ke router/Internet ataupun HTTP POST ke server Next.js pada baseline ini. Fitur pengiriman baru harus ditambahkan **tanpa menghilangkan SoftAP diagnostics dan timing RS485/WDI**.
- `handleStatus()` masih mengirim string versi firmware `0.7.2`, sedangkan header sumber menyebut `0.7.4`: inkonsistensi label **disimpan apa adanya** dan perlu diperbaiki dalam versi final.

## Checklist migrasi menuju firmware final

1. Bekukan snapshot ini. Tambahkan Wi-Fi STA auto reconnect dan HTTP/HTTPS POST di firmware **baru**, bukan mengubah baseline langsung.
2. Tambahkan status `warmup_like`, `data_valid`, `flags`, `module_c`, `online`, counter komunikasi, `ch4_connected`/`ch5_connected` ke kontrak `/api/telemetry` (dengan validasi dan status-only heartbeat). Pastikan konsumsi web tidak menyamakan 0 ppm dan invalid.
3. Pilih mapping `CH4/CH5` → tungku/cerobong **setelah** penelusuran kabel/label di lapangan. Terapkan satu sumber mapping konsisten.
4. Prioritaskan timing Modbus dan WORK/WDI; pengiriman HTTP tidak boleh mengganggu update status maupun waktu respons bus. Uji saat Wi-Fi down, server HTTP gagal, ZEH warm-up, Ebyte fault, dan RS485 terputus.
5. Validasi interpretasi bit alarm/fault dan strategi warm-up terhadap dokumentasi Winsen serta pengukuran nyata. Tambahkan pemisahan indikator **status sensor** dari **prediksi risiko proses LoT**.
6. Lakukan uji hardware sendiri: baseline disimpan sebagai referensi source, belum diverifikasi ulang pada perangkat dengan revisi repository ini.

