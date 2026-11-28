# Firmware EG118 terbaru (sensor RS485 asli)

**Firmware monitoring sensor asli yang terbaru:** [eg118_field_v1_0_0](eg118_field_v1_0_0/README.md). Ini berbeda dari dummy sender di bawah. Uji compile dan commissioning hardware sebelum flashing; jangan menyamakan tes server dengan tes fisik.

---

# ESP32 — ADI Smart Incinerator (dummy 10 detik ke VPS)

Firmware **Arduino IDE** untuk menguji sistem cloud tanpa sensor fisik. ESP32 mengirim delapan parameter dummy via `HTTPS POST https://adi-incinerator.live/api/telemetry` setiap **10 detik**. Enam fase simulasi: IDLE → HEATING → ACTIVE → WARNING → CRITICAL → COOLING.

**Penting:** Semua nilai adalah data sintetis untuk pengujian perangkat lunak, bukan pengukuran emisi maupun penilaian keamanan pembakaran. Jangan menyalakan alarm operasional berdasarkan nilai dummy.

## 1. Siapkan Arduino IDE

- Instal **ESP32 by Espressif Systems** dari Boards Manager.
- Pilih board dan COM port yang benar (ESP32 Dev Module, ESP32-S3 atau ESP32-C3).
- Buka `firmware/adi_esp32_sender/adi_esp32_sender.ino`.
- Library `WiFi.h`, `WiFiClientSecure.h`, dan `HTTPClient.h` sudah tersedia dalam paket board ESP32; ArduinoJson tidak dibutuhkan.

## 2. Konfigurasi Wi-Fi dan token VPS

Duplikasikan `config.example.h` menjadi `config.h` di folder sketch. Isi **hanya** file `config.h` dengan data sebenarnya:

```cpp
#define WIFI_SSID "WiFi_2_4GHz"
#define WIFI_PASSWORD "PASSWORD_WIFI_PRIBADI"
#define TELEMETRY_URL "https://adi-incinerator.live/api/telemetry"
#define TELEMETRY_INGEST_KEY "TOKEN_INGEST_DARI_ENV_VPS"
```

`TELEMETRY_INGEST_KEY` harus persis sama dengan nilai di lingkungan service Next.js **VPS**, panjang minimal 24 karakter. Ini **berbeda** dari username/password Admin. Untuk melihat lokasi env file tanpa menampilkan isinya: `sudo systemctl cat adi-smart-incinerator`. Jangan kirimkan token atau file `config.h` ke chat maupun GitHub—file tersebut diabaikan oleh `.gitignore`.

ESP32 memerlukan internet lewat Wi-Fi 2,4 GHz, akses DNS, dan akses NTP untuk menyetel jam UTC. Jika menggunakan hotspot HP, periksa fitur tethering dan pembatasan jaringan.

## 3. HTTPS dan sertifikat

Firmware menggunakan `WiFiClientSecure::setCACert` dengan **CA root publik** dari `ca_roots.h` (ISRG Root X1 / USERTrust RSA), plus sinkronisasi waktu NTP. Firmware **tidak** menonaktifkan validasi sertifikat dan tidak mengikuti redirect. Token hanya dikirim setelah koneksi HTTPS berhasil divalidasi.

Karena sertifikat server Caddy dapat diterbitkan oleh CA berbeda atau berganti saat pembaruan, **periksa chain sertifikat domain** sebelum mengandalkan firmware:

```bash
openssl s_client -connect adi-incinerator.live:443 -servername adi-incinerator.live -showcerts </dev/null
```

Periksa issuer dan rantai ke ISRG Root X1 atau USERTrust RSA. Bila Caddy memakai root lainnya, perbarui `ca_roots.h` terlebih dahulu menggunakan CA root resmi, bukan sertifikat leaf yang berganti setiap beberapa bulan. Jangan mengganti kode dengan `setInsecure()`.

Untuk uji **LAN terisolasi** tanpa HTTPS, `TELEMETRY_URL` masih boleh `http://192.168.x.x:3000/api/telemetry` atau alamat privat RFC1918; HTTP publik ditolak firmware.

## 4. Upload dan jalankan

1. Hentikan sender dummy Node.js pada laptop (`npm run sender:virtual`) agar data uji tidak bercampur.
2. Upload firmware melalui Arduino IDE.
3. Buka **Serial Monitor, 115200 baud**.
4. Tunggu `[WiFi] Connected`, lalu sinkronisasi NTP; kiriman berjalan tiap 10 detik.
5. Hasil sukses berupa `HTTP 201`, contohnya:

```text
[WiFi] Connected, ESP IP: 192.168.1.124
[ESP32] IDLE     | HTTP 201 | Tungku 54.0 C | CO 11.0 ppm | VOC 18.0 ppm
```

6. Login ke **https://adi-incinerator.live/login** lalu lihat dashboard dan grafik yang berubah.

## 5. Diagnosis error

- **HTTP 201:** server menerima pembacaan; periksa tampilannya di dashboard.
- **HTTP 401:** token salah; cocokkan dengan `TELEMETRY_INGEST_KEY` di VPS, bukan password Admin.
- **HTTP 503:** Redis/penyimpanan produksi belum siap atau kunci belum dikonfigurasi.
- **HTTP 400:** field JSON ditolak, periksa skema.
- **Kode HTTP negatif / NTP menunggu:** cek Wi-Fi, DNS, tanggal NTP, rantai CA TLS, Caddy/port 443, atau koneksi internet. Firmware tidak akan mengirim token lewat HTTPS yang gagal diverifikasi.
- **Grafik tidak berubah:** pastikan pengirim dummy lain dihentikan, API Redis aktif, dan browser login ke domain yang benar.

## Format payload

```json
{
  "deviceId": "ESP32-ADI-01",
  "furnace": 54.0,
  "stack": 41.0,
  "ambient": 29.4,
  "humidity": 70.0,
  "co": 11.0,
  "h2": 2.3,
  "voc": 18.0,
  "smoke": 0.012
}
```

Sistem menyimpan hingga 120 pembacaan live terakhir dan arsip sampel dengan retensi **7 hari** di Redis (jika konfigurasi VPS sudah benar). Dengan satu ESP, interval 10 detik menghasilkan **8.640 POST per hari**. Jangan menganggap kapasitas VPS aman tanpa memonitor penggunaan RAM/CPU dan Redis saat tes sebenarnya.

## Tahap setelah dummy

Ganti `makeReadings()` dengan sensor RS485 setelah protokol, satuan, dan kalibrasi tervalidasi. Simpan cara membedakan perangkat simulasi dan pembacaan sesungguhnya agar tidak keliru saat analisis.
