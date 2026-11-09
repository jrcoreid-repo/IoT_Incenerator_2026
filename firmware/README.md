# ESP32 — ADI Smart Incinerator (pengirim data dummy)

Firmware Arduino IDE untuk mengetes dashboard **tanpa sensor fisik**. ESP32 mengirim delapan parameter melalui `HTTP POST /api/telemetry` dengan token ingest. Data berubah setiap 3 detik dan berputar melalui enam fase: IDLE → HEATING → ACTIVE → WARNING → CRITICAL → COOLING. Hanya gunakan di jaringan lokal saat pengujian.

## 1. Siapkan Arduino IDE

- Pasang **ESP32 by Espressif Systems** melalui Boards Manager.
- Pilih tipe board ESP32 yang cocok dan port USB perangkat.
- Buka sketch `firmware/adi_esp32_sender/adi_esp32_sender.ino`.
- Tidak perlu pustaka ArduinoJson; hanya `WiFi.h` dan `HTTPClient.h` bawaan core ESP32.

## 2. Buat konfigurasi rahasia

Di folder sketch, duplikasikan `config.example.h` lalu beri nama **`config.h`**.

Isi:
```cpp
#define WIFI_SSID "Nama_WiFi_2_4GHz"
#define WIFI_PASSWORD "Password_WiFi"
#define TELEMETRY_URL "http://192.168.1.100:3000/api/telemetry"
#define TELEMETRY_INGEST_KEY "TOKEN_INGEST_SAMA_SEPERTI_ENV_LOCAL"
```

Ganti `192.168.1.100` sesuai IPv4 **laptop**, yang dapat dilihat melalui `ipconfig`. Jangan gunakan `localhost` di ESP32: itu alamat ESP32 sendiri. Hubungkan ESP32 dan laptop ke Wi-Fi/LAN yang sama, tanpa client isolation. Token harus **sama persis** dengan `TELEMETRY_INGEST_KEY` di `.env.local`, dan minimum 24 karakter. **Jangan commit `config.h` atau membagikan token/password.** File ini sudah masuk `.gitignore`.

## 3. Nyalakan server di laptop

Buka terminal di root proyek:
```cmd
npm run dev -- -H 0.0.0.0
```

Jika `.env.local` diubah, restart server. Jika Windows Firewall bertanya, izinkan Node.js untuk jaringan **Private** saja.

## 4. Upload firmware dan periksa Serial Monitor

Upload sketch ke ESP32 lalu buka Serial Monitor di **115200 baud**. Jika berhasil, keluaran seperti:

```
[WiFi] Connected, ESP IP: 192.168.1.124
[ESP32] IDLE     | HTTP 201 | Tungku 54.0 C | CO 11.0 ppm | VOC 18.0 ppm
[ESP32] HEATING  | HTTP 201 | Tungku 79.4 C | CO 14.7 ppm | VOC 25.1 ppm
```

Contoh di atas hanya ilustrasi. **HTTP 201** berarti server sudah menerima payload. Buka `http://<IP-LAPTOP>:3000/login`, login, lalu lihat dashboard. Endpoint pembaca telemetry memerlukan sesi admin, tetapi **pengirim ESP32 tidak perlu login admin** karena menggunakan token sendiri.

### Bila gagal

- **HTTP -1 / gagal koneksi:** IP laptop salah, beda Wi-Fi, firewall, atau server tidak memakai `-H 0.0.0.0`.
- **HTTP 401:** token berbeda dari `.env.local`.
- **HTTP 503:** `TELEMETRY_INGEST_KEY` belum disetel atau penyimpanan server belum tersedia.
- **HTTP 400:** payload JSON gagal validasi (periksa nama/satuan field).
- **Tidak ada angka pada dashboard:** pastikan kamu sudah login dan pengirim dummy dari Node dihentikan agar device tidak bercampur.

## Format JSON yang dikirim

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

Nilai merupakan **hasil generator data uji**, bukan hasil sensor, nilai emisi, atau konsentrasi furan. Skor prediksi risiko furan dihitung di dashboard melalui LoT. Tidak ada perintah kendali ke insinerator.

## Tahap berikutnya

Ganti sumber pembacaan `makeReadings()` dengan fungsi pembacaan sensor RS485 sesuai register dan kalibrasi perangkat, tetapi pertahankan nama field JSON dan autentikasi API. Di deployment domain, gunakan **HTTPS dengan sertifikat server diverifikasi**, bukan pengabaian validasi sertifikat (`setInsecure`). Firmware saat ini sengaja hanya mengizinkan HTTP untuk pengujian di LAN; belum siap untuk pengiriman data ke internet.
