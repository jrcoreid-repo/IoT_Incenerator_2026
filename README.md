# JR-AIoT — ADI Smart Incinerator

Dashboard monitoring proses pembakaran berbasis **JR-AIoT** untuk Desa Caturharjo, Pandak, Bantul.

## Tampilan minimalis untuk operator (usulan V2)
- Halaman masuk sederhana, tanpa gambar cerobong atau ilustrasi mesin.
- Beranda menonjolkan status proses dan empat parameter utama (suhu pembakaran, suhu cerobong, CO, VOC).
- Empat parameter tambahan tetap dapat dibuka melalui **Lihat parameter lainnya**.
- Ringkasan peringatan dan grafik suhu dengan istilah sederhana.
- Riwayat, analisis percobaan, daftar perangkat, dan pengaturan tetap tersedia.
- Responsif di komputer dan ponsel; semua menu bisa diakses pada ponsel.
- Mode terang sebagai tampilan bawaan, dengan pilihan mode gelap.

## Penting: prototipe, bukan pemantauan lapangan

**Semua angka dan grafik masih disimulasikan oleh `lib/mock-data.ts`.** Angka berubah otomatis tiap 3 detik untuk mendemonstrasikan antarmuka. Belum ada pembacaan sensor yang masuk, koneksi server, maupun penyimpanan riwayat nyata.

- Label **Data Simulasi** berarti pembacaan belum berasal dari alat.
- Daftar perangkat berstatus **Belum tersambung**, bukan online.
- Peringatan CO/VOC memakai ambang untuk demonstrasi, bukan batas keselamatan resmi.
- Indeks dioksin/furan adalah percobaan berbasis aturan sederhana dan **bukan** pengukuran konsentrasi atau prediksi emisi tervalidasi.
- Tombol rentang waktu yang belum berfungsi sengaja dihilangkan sampai ada data historis nyata.
- Konfigurasi batas hanya tersimpan di browser, belum dikirim ke gateway.

## Menjalankan lokal

```bash
cp .env.example .env.local
npm install
npm run dev
```

Ubah `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.env.local`. Buka `http://localhost:3000` untuk tampilan umum dan `http://localhost:3000/login` untuk pengelola.

**Catatan keamanan:** Login V1 saat ini hanya mekanisme demonstrasi, belum menggunakan sesi terenkripsi/terverifikasi yang layak untuk internet publik. Jangan deploy dashboard ini ke internet atau menghubungkannya ke kendali perangkat sebelum autentikasi, otorisasi, dan data telemetry diperkuat.

## Struktur pengembangan

- `dashboard-v1`: basis dashboard sebelumnya.
- `design/minimal-operator-2026`: usulan perapihan antarmuka.
- `main`: inisialisasi repository.

Integrasi JR-AIoT RS485, API telemetry, database, dan analisis AI belum dilaksanakan.
