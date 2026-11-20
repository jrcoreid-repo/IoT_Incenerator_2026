# JRAIoT Vision — roadmap pemantauan asap

Status per 20 November 2026: **UI Pantauan Asap sudah dirancang; pengambilan gambar CCTV, service inference, API vision, dan integrasi ke dashboard belum diimplementasikan atau diverifikasi di production.**

Dokumen ini menyimpan keputusan desain untuk prototipe **low-cost / low-compute** yang dapat dioperasikan di lingkungan desa. Hindari menyebut mockup sebagai stream/video live atau hasil deteksi nyata.

## Keputusan arsitektur v1 (20 November 2026)

- **Kamera uji:** SSQJ yang memakai aplikasi V380/V380 Pro, saat ini **masih di lab**, belum di lokasi incinerator. ONVIF terlihat aktif di aplikasi. IP lokal yang pernah dilaporkan: `192.168.1.4` (dapat berubah). **Keberhasilan koneksi RTSP belum dikonfirmasi.**
- **Akses kamera:** kamera tetap di jaringan lokal. Tes RTSP/ONVIF secara lokal terlebih dahulu; saat dipindahkan ke lokasi, sediakan gateway ringan di jaringan kamera (komputer kecil/Raspberry Pi/router kompatibel) untuk mengambil frame dan mengirimkannya **keluar melalui HTTPS terautentikasi**. Jangan mengekspos port RTSP/ONVIF atau kredensial kamera ke internet maupun frontend.
- **Sampling:** ambil **1 frame setiap 60 detik** (bukan analisis video 24/7). Inference boleh memerlukan sekitar **5 detik**; jangan menjalankan dua pekerjaan inference secara bersamaan. Interval 30 detik hanya opsi setelah benchmark.
- **AI:** model **YOLO Segmentation ONNX hasil training pengguna**, ukuran file **sekitar 10 MB** (dikonfirmasi pengguna). Jalankan dengan **ONNX Runtime CPU**; target awal 1 worker/1 thread, input 416×416 atau 512×512 untuk uji, dan bandingkan kualitas dengan 640×640. Nama/arsitektur pasti model dan hasil benchmark **belum diketahui**.
- **Deployment komputasi:** untuk tahap awal, **coba gunakan VPS JRAIoT yang sama**, bukan wajib server Vision kedua. Service inference berjalan terpisah dari Next.js, Redis, dan layanan sensor; jalankan dengan prioritas/batas sumber daya yang menjaga website tetap responsif.
- **Tampilan:** dashboard menampilkan **satu gambar hasil analisis terbaru** (opsional overlay mask segmentasi), waktu capture, waktu selesai diproses, status koneksi, dan ringkasan kondisi visual. Ketika hasil baru valid tersedia, timpa gambar sebelumnya secara atomik; gunakan versi/timestamp atau cache-control agar browser tidak menampilkan gambar cache lama.
- **Retensi gambar:** hanya **1 gambar terbaru** disimpan sebagai artefak operasional; **tidak** menyimpan arsip foto atau rekaman video. Frame mentah sementara diproses di memori dan dibuang setelah selesai. Tidak membuat backup/versi otomatis gambar yang ditimpa.
- **Retensi log:** **hasil analisis tekstual/terstruktur setiap siklus tetap disimpan**, berikut **event penting** (mis. transisi tidak ada asap → ada asap, meningkatnya area segmentasi, kamera offline). Log Vision tampil di riwayat waktu yang sama dengan telemetry sensor, dikorelasikan menggunakan **timestamp dan ID perangkat**, tetapi tidak perlu mengubah format/pencatatan sensor RS485 yang sudah ada. Kebijakan retensi log dapat dikonfigurasi kemudian.
- **Kegagalan/ketertinggalan:** saat capture/inference gagal, jangan mengganti gambar lama dengan hasil palsu atau menghapus histori. Tampilkan gambar terakhir dengan cap waktu dan label **belum ada gambar terbaru/offline**; simpan event error dan jangan memberi status kondisi asap saat ini dari data lama.

### Kapasitas VPS yang sudah diperiksa pengguna

Output pemeriksaan `nproc`, `free -h`, `lscpu`, dan `df -h /`:

| Komponen | Hasil |
| --- | --- |
| CPU | **2 vCPU**, x86_64, Intel Core Processor (Broadwell, IBRS) |
| RAM | **1.9 GiB total**, **1.5 GiB available** saat pemeriksaan |
| Swap | **2.0 GiB** total, **29 MiB** digunakan |
| Disk root | **19 GiB** total, **8.5 GiB** dipakai, **10 GiB** tersedia |
| Layanan bersama | Next.js dashboard, Redis, systemd service incinerator, Caddy |

**Kesimpulan bersyarat:** 1 frame per 60 detik dengan ONNX ~10 MB **layak diuji**, tetapi **belum boleh dinyatakan pasti cukup** sampai ada benchmark latensi CPU, peak RSS, swap, dan dampak terhadap respons dashboard. Ukuran file ONNX 10 MB **tidak** sama dengan penggunaan RAM inference.

### Rantai data v1

1. Kamera SSQJ V380 dalam LAN → gateway lokal membaca stream dan mengambil frame tiap 60 detik.
2. Gateway mengirim frame melalui HTTPS terautentikasi ke VPS; server memvalidasi ukuran payload, identitas, timestamp, dan pembatasan request.
3. Service Vision tersendiri menjalankan **satu** inference ONNX segmentation di CPU; menghitung metrik seperti *smoke detected*, confidence, dan **persentase area masker pada region of interest**, serta warna visual **jika tervalidasi**.
4. Jika sukses, simpan/replace **latest image** dan metadata bersamaan secara aman; tampilkan pada tab **Pantauan Asap** yang membutuhkan login.
5. Simpan setiap hasil analisis sebagai catatan historis ringkas dan catat event penting secara terpisah. Dashboard menggabungkan kronologi Vision dan sensor berdasarkan waktu.
6. Ketika kamera/model gagal, tandai status stale/offline dan log penyebabnya; jangan membuat nilai pengganti.

### Contoh payload log (hanya ilustrasi, bukan data nyata)

```json
{
  "device_id": "cam-01",
  "captured_at": "2026-11-20T12:00:00+07:00",
  "processed_at": "2026-11-20T12:00:05+07:00",
  "smoke_detected": true,
  "confidence": 0.91,
  "mask_area_percent_in_roi": 18.4,
  "visual_status": "asap terdeteksi",
  "event_type": "SMOKE_PRESENT"
}
```

`mask_area_percent_in_roi` adalah luas piksel tersegmentasi relatif terhadap ROI, **bukan** opasitas fisik asap, kadar emisi, atau indeks aman/bahaya terkalibrasi. Event tidak harus muncul setiap siklus; pengukuran ringkas tiap siklus tetap tersedia untuk analisis historis.

## Rencana implementasi dan validasi

- [ ] Tes jaringan LAN kamera SSQJ: ONVIF/RTSP berhasil membuka video dan kualitas frame memadai; kredensial disimpan privat.
- [ ] Jalankan hasil YOLO ONNX pada cuplikan frame uji di lab; evaluasi segmentasi asap/false positive pada latar cerobong.
- [ ] Benchmark model di VPS **tanpa mengganggu layanan production** (mis. 20–30 frame secara terkendali): latensi median/p95, puncak RSS, CPU, swap, respons Next.js. Mulai 60 detik, 1 worker.
- [ ] Implementasikan capture + push HTTPS lewat gateway lokal, dengan retry/backoff dan batas ukuran frame.
- [ ] Implementasikan service inferensi CPU, penyimpanan gambar latest-only, histori log Vision, event, dan status stale.
- [ ] Integrasikan output sebenarnya ke UI Pantauan Asap yang sudah ada, tetap lewat autentikasi aplikasi.
- [ ] Uji kamera offline, upload gagal, inference lebih lama dari interval, restart service, dan pemulihan jaringan.
- [ ] Baru setelah lolos uji, pindahkan kamera dari lab ke lokasi incinerator pada titik aman dari panas/debu/hujan.

## Versi UI awal yang sudah tersedia

- Navigasi **Pantauan Asap** tersedia untuk pengguna yang sudah login.
- Area CAM 01 (cerobong) menampilkan status **Belum terhubung**, bukan video simulasi.
- Kartu keberadaan asap, kepekatan visual, warna asap, dan status analisis tidak mengarang angka ketika kamera belum ada.
- UI responsif dan memakai gaya dashboard JRAIoT yang sudah ada.
- Belum ada perubahan pada API telemetry, database Redis, firmware, akses login, maupun ambang LoT untuk fitur Vision.

## Batas interpretasi ilmiah

Kamera membantu mengamati **keberadaan, warna, sebaran, dan karakteristik visual** asap. Kamera biasa **tidak** dapat mengukur CO, VOC, dioksin, furan, atau menyatakan gas buang **aman**. Estimasi opasitas dalam persen baru layak ditampilkan setelah kalibrasi/validasi metode yang sesuai. Sensor RS485 tetap menjadi sumber utama telemetry suhu dan gas.
