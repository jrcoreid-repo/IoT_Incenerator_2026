# JR-AIoT — IoT Incenerator 2026

Prototype dashboard monitoring cerobong berbasis **JR-AIoT**.

## Fitur V1
- Antarmuka Bahasa Indonesia
- Responsive desktop dan mobile
- Tema gelap / terang
- Login/logout admin sederhana
- Data realtime simulasi
- Status pembakaran dinamis
- Suhu tungku, suhu cerobong, suhu & kelembapan lingkungan
- CO, H₂, VOC, indikator asap
- Prediksi risiko dioksin/furan + wawasan AI simulasi
- Tab Riwayat & Grafik, Analisis AI, Alarm, Perangkat, Pengaturan
- Pengaturan threshold khusus admin

## Menjalankan lokal

1. Salin environment:

```bash
cp .env.example .env.local
```

2. Ubah username dan password admin di `.env.local`.

3. Instal dan jalankan:

```bash
npm install
npm run dev
```

4. Buka http://localhost:3000

## Branch
Pengembangan V1 berada di branch `dashboard-v1`.

> Data V1 masih simulasi. Integrasi database, API telemetry, JR-AIoT hardware, dan AI API dilakukan pada tahap berikutnya.
