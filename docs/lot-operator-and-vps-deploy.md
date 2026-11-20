# LoT: panduan operator dan update VPS

Dokumen ini untuk ADI Smart Incinerator. Analisis LoT adalah aturan pemantauan sensor, BUKAN Artificial Intelligence yang mengukur furan dan BUKAN penetapan keselamatan/pelanggaran baku mutu. Suhu dan gas dihitung dari nilai terbaru serta ambang internal yang dapat diubah admin.

## Bahasa yang tampil di dashboard

- **Kondisi tungku:** membandingkan suhu CH5 dengan batas awal dan batas pembakaran aktif yang telah diatur operator. Suhu rendah tidak otomatis berarti emisi aman.
- **Perubahan suhu:** hanya membandingkan dua data dari ID pengirim yang sama dengan selang maksimal 60 detik. Data semalam tidak dipakai sebagai selisih suhu baru.
- **Cerobong:** CH4 menjelaskan suhu gas buang. Cerobong masih panas setelah tungku dingin perlu tetap dipantau, tetapi bukan bukti konsentrasi furan tertentu.
- **CO dan VOC:** bandingkan dengan ambang internal. CO/VOC sama dengan 0 tidak menjamin furan, dioksin, atau gas lain nol. Nilai modul ZEH100 yang belum siap tidak dipakai.
- **Lingkungan dan H2:** penjelasan suhu udara, RH, dan nilai H2 yang tersedia. H2 belum mempunyai ambang keselamatan terkalibrasi dalam LoT.
- **Kesehatan sensor:** pemeriksaan RS485 CWT ID3, Ebyte ID2 CH4/CH5, dan ZEH100 ID1. Counter error yang bertambah adalah kumulatif sejak boot.
- **Indikator proses furan:** dinonaktifkan saat tungku belum memasuki suhu proses atau data penting tidak lengkap. Bila aktif, angka 0–100 adalah skor eksperimen, BUKAN kadar furan, bukan probabilitas emisi, dan bukan bukti aman.
- **Asal data:** status missing/simulasi, jumlah parameter numerik yang tersedia, dan waktu terakhir yang diterima server. Status OFFLINE menghentikan kesimpulan langsung.

## Pemeriksaan otomatis dan manual

Kualitas wajib: firmware yang mengirim sensors.cwt, sensors.ebyte, sensors.zeh100; satu paket valid per siklus; jangan kirim data dummy ke database penelitian. Tidak ada sensor asap numerik di EG118. Jika sebuah nilai kosong, sistem tidak boleh menggantinya dengan 0.

Pengujian baru:
- npm run test:furan
- npm run test:insights
- npm run test:auth
- npm run build

## Panduan deployment VPS existing (Caddy + Redis + systemd)

Aplikasi publik sudah berjalan dengan unit systemd **adi-smart-incinerator.service**. Kita membuat checkout release baru untuk menjaga website aktif saat build. Jangan melakukan npm build di folder live karena aplikasi sedang melayani permintaan; jangan mengubah Caddy, Redis, firmware, token, session secret, atau kredensial.

**Pra-syarat:** SSH sebagai jrcore; cek backup Redis dan systemd, dan pastikan HEAD GitHub target telah lulus Actions. Username/password/token tidak boleh dikirim ke chat.

1. Masuk ke repository dasar dan ambil branch:

   ~~~sh
   cd /home/jrcore/apps/adi-smart-incinerator
   git fetch origin design/minimal-operator-2026
   git rev-parse --short origin/design/minimal-operator-2026
   ~~~

2. Cari folder service yang benar, lalu buat release (ganti REVISION sesuai SHA dari GitHub, misal d1fd7e7 jika SHA ini memang sudah lulus CI). Contoh:

   ~~~sh
   ACTIVE_DIR="$(systemctl show -p WorkingDirectory --value adi-smart-incinerator.service)"
   echo "Active: $ACTIVE_DIR"
   test -f "$ACTIVE_DIR/.env.local" || { echo "Environment tidak ditemukan"; exit 1; }
   REVISION="$(git rev-parse --short origin/design/minimal-operator-2026)"
   NEW_DIR="/home/jrcore/apps/adi-smart-incinerator-release-$REVISION"
   git worktree add --detach "$NEW_DIR" "origin/design/minimal-operator-2026"
   ~~~

   Pastikan service lama tetap aktif sebelum pindah. Perintah shell menggunakan exit 1 hanya jika dijalankan dalam skrip; di terminal interaktif jika error, berhenti secara manual, jangan lanjut.

3. Salin environment sebagai file privat lalu install/build di folder baru:

   ~~~sh
   cd "$NEW_DIR"
   umask 077
   cp -a "$ACTIVE_DIR/.env.local" .env.local
   chmod 600 .env.local
   npm install
   npm run test:sender
   npm run test:deploy
   npm run test:history
   npm run test:furan
   npm run test:insights
   npm run deploy:check
   npm run build
   npm run test:auth
   ~~~

   Semua perintah wajib sukses sebelum berpindah service. Jangan mengekspos isi .env.local. npm install digunakan karena package-lock.json belum dilacak di repository.

4. Backup unit systemd dan cek path-nya:

   ~~~sh
   sudo cp -a /etc/systemd/system/adi-smart-incinerator.service /etc/systemd/system/adi-smart-incinerator.service.bak-before-lot
   sudo systemctl show adi-smart-incinerator.service --no-pager -p WorkingDirectory -p ExecStart
   ~~~

5. Baru setelah build/test sukses, arahkan WorkingDirectory dan ExecStart ke folder release baru. Pastikan hanya path prefix yang benar berubah:

   ~~~sh
   sudo sed -i "s|$ACTIVE_DIR|$NEW_DIR|g" /etc/systemd/system/adi-smart-incinerator.service
   sudo systemctl daemon-reload
   sudo systemctl show adi-smart-incinerator.service --no-pager -p WorkingDirectory -p ExecStart
   ~~~

   **JANGAN restart bila output path tidak menunjuk ke NEW_DIR yang baru dibuild.** Setelah diverifikasi:

   ~~~sh
   sudo systemctl restart adi-smart-incinerator.service
   sudo systemctl is-active adi-smart-incinerator.service
   ~~~

6. Smoke tests:

   ~~~sh
   curl -s -o /dev/null -w "LOCAL %{http_code}\n" http://127.0.0.1:3000/login
   curl -s -o /dev/null -w "PUBLIC %{http_code}\n" https://adi-incinerator.live/login
   curl -s -o /dev/null -w "ADMIN %{http_code} %{redirect_url}\n" https://adi-incinerator.live/admin
   curl -s -o /dev/null -w "API %{http_code}\n" https://adi-incinerator.live/api/telemetry
   redis-cli ping
   sudo journalctl -u adi-smart-incinerator.service -n 40 --no-pager
   ~~~

   Target: login 200; admin 307 mengarah ke https://adi-incinerator.live/login; GET telemetry tanpa sesi 401; Redis PONG; service active. Cek login dan tab Analisis di browser desktop serta HP. Konfirmasi status idle = indeks furan tidak dinilai dan pesan operator baru tampil. Jangan tes dengan kirim telemetry dummy ke VPS.

7. Rollback bila ada 5xx atau gagal login:

   ~~~sh
   sudo cp -a /etc/systemd/system/adi-smart-incinerator.service.bak-before-lot /etc/systemd/system/adi-smart-incinerator.service
   sudo systemctl daemon-reload
   sudo systemctl restart adi-smart-incinerator.service
   sudo systemctl is-active adi-smart-incinerator.service
   ~~~

   Unit lama menunjuk ke release sebelumnya yang tidak dihapus. Redis dan Caddy sama sekali tidak perlu di-reset. Jika sudah ada backup dengan nama bak-before-lot, simpan salinan bertimestamp sebelum menimpa.

Catatan: perubahan code via GitHub TIDAK otomatis mengubah VPS. Bukti go-live memerlukan log restart/cek service dan pemeriksaan browser sesudah proses di atas. Firmware EG118 v1.0.0 tetap terpisah dan tidak perlu di-flash untuk rilis UI/LoT ini.
