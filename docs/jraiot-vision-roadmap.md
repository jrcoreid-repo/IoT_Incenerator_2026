# JRAIoT Vision — rancangan antarmuka pemantauan asap

Status: **desain antarmuka saja**. Belum ada kamera, streaming, service AI, API vision, nilai sensor visual, atau integrasi production.

## Versi UI pertama

- Navigasi **Pantauan Asap** tersedia untuk pengguna yang sudah login.
- Area CAM 01 (cerobong) menampilkan status **Belum terhubung**, bukan video simulasi.
- Kartu keberadaan asap, kepekatan visual, warna asap, dan status analisis tidak mengarang angka ketika kamera belum ada.
- UI responsif dan memakai gaya dashboard JRAIoT yang sudah ada.
- Tidak ada perubahan pada API telemetry, database Redis, firmware, akses login, maupun ambang LoT.

## Integrasi mendatang (belum dibuat)

1. Kamera tetap dipasang di lokasi dengan pelindung terhadap debu, hujan, dan panas, pada jarak yang aman dari cerobong. Posisi kamera harus cukup stabil, dengan latar pembanding yang terlihat untuk menilai plume.
2. Stream video dibawa ke **server vision terpisah** melalui jaringan terproteksi, bukan diproses pada EG118/JRAIoT gateway sensor.
3. Service vision mendeteksi/menyegmentasi plume dan melaporkan status kamera, hasil klasifikasi visual, waktu, serta kualitas data melalui API terautentikasi.
4. Backend dashboard memverifikasi identitas service, kesegaran waktu, dan payload sebelum menampilkan data. Mode offline dan tidak-yakin harus jelas.
5. Jika diperlukan, live video diberikan melalui gateway streaming yang terautentikasi. Jangan menaruh URL RTSP, kredensial, atau akses kamera publik di frontend.
6. Simpan metadata dan cuplikan saat ada peristiwa yang perlu ditinjau, dengan pengaturan retensi dan pembatasan akses.

## Batas interpretasi

Kamera dapat membantu mengamati **keberadaan, warna, sebaran, dan kepekatan visual** asap. Kamera biasa tidak dapat mengukur CO, VOC, dioksin, furan, atau menyatakan gas buang **aman**. Estimasi opasitas dalam persen baru layak ditampilkan setelah kalibrasi dan validasi metode yang sesuai. Sensor RS485 tetap menjadi sumber utama telemetry suhu dan gas.
