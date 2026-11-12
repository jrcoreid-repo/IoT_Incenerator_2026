import type { Telemetry } from "./telemetry";
import type { LotResult, Thresholds } from "./logic-tree";

// Informasi operator berbasis aturan, BUKAN sensor furan, prediksi laboratorium,
// penilaian kesehatan paparan, atau sistem keselamatan pembakaran.
export type InsightTone = "info" | "attention" | "alert" | "unknown";
export type OperatorInsight = {
  id: string;
  label: string;
  status: string;
  tone: InsightTone;
  meaning: string;
  explanation: string;
  action: string;
};
export type OperatorReport = {
  headline: string;
  subheading: string;
  note: string;
  time: string | null;
  insights: OperatorInsight[];
  actions: string[];
};

const num = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const fmt = (n: number, unit: string) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + unit;
const make = (id: string, label: string, status: string, tone: InsightTone,
  meaning: string, explanation: string, action: string): OperatorInsight =>
  ({ id, label, status, tone, meaning, explanation, action });
const sourceIsVirtual = (id: string) => /^ESP32-(VIRTUAL|TEST|DUMMY)/i.test(id);

function comparableDelta(current: Telemetry, previous: Telemetry | null): number | null {
  if (!previous || previous.deviceId !== current.deviceId || !num(previous.furnace) || !num(current.furnace)) return null;
  const gap = Date.parse(current.receivedAt) - Date.parse(previous.receivedAt);
  return Number.isFinite(gap) && gap >= 0 && gap <= 60000 ? current.furnace - previous.furnace : null;
}

export function explainReadings(
  current: Telemetry | null,
  previous: Telemetry | null,
  lot: LotResult,
  thresholds: Thresholds,
  fresh: boolean
): OperatorReport {
  if (!current || !fresh) {
    return {
      headline: current ? "Kabar terbaru dari alat belum masuk." : "Belum ada kiriman dari alat.",
      subheading: current
        ? "Angka yang pernah tampil adalah data lama. Kami tidak menyimpulkan kondisi sekarang dari data yang sudah lewat."
        : "Dashboard menunggu data sensor. Tidak ada suhu atau angka gas yang akan ditebak.",
      note: "Tanpa kiriman terbaru, semua analisis ditunda. Grafik lama bukan kondisi langsung.",
      time: current?.receivedAt ?? null,
      insights: [make("connection", "Sambungan alat", "BELUM ADA DATA TERBARU", "unknown",
        "Server belum menerima data terbaru dari gateway.",
        "Perangkat mungkin mati atau koneksi Wi-Fi/internet sedang terputus. Periksa langsung di lapangan.",
        "Cek listrik EG118, jaringan Wi-Fi, dan apakah HTTP POST berhasil dengan kode 201.")],
      actions: ["Cek daya dan jaringan EG118.", "Buka /status pada AP diagnostik untuk melihat kegagalan Wi-Fi/HTTPS."]
    };
  }

  const diag = current.sensors;
  const cwtOK = !diag || diag.cwt.online;
  const stackOK = !diag || (diag.ebyte.online && diag.ebyte.ch4Connected);
  const furnaceOK = !diag || (diag.ebyte.online && diag.ebyte.ch5Connected);
  const gasOK = !diag || (diag.zeh100.online && diag.zeh100.dataValid);
  const furnace = furnaceOK ? current.furnace : null;
  const stack = stackOK ? current.stack : null;
  const ambient = cwtOK ? current.ambient : null;
  const humidity = cwtOK ? current.humidity : null;
  const co = gasOK ? current.co : null;
  const voc = gasOK ? current.voc : null;
  const h2 = gasOK ? current.h2 : null;
  const delta = comparableDelta(current, previous);
  const idle = num(furnace) && furnace < thresholds.transitionTemp;
  const warmup = diag?.zeh100.online && diag.zeh100.warmupLike === true;
  const virtual = sourceIsVirtual(current.deviceId);
  const items: OperatorInsight[] = [];
  const actions: string[] = [];
  const add = (action: string) => { if (!actions.includes(action)) actions.push(action); };

  // 1. Tungku
  if (!num(furnace)) {
    items.push(make("furnace", "Tungku", "BELUM TERBACA", "unknown",
      "Kita belum tahu suhu tungku karena sensornya tidak memberikan angka yang valid.",
      "Tanpa suhu tungku, kondisi proses pembakaran tidak bisa dinilai.",
      "Periksa termokopel CH5 dan modul Ebyte."));
    add("Cek termokopel tungku CH5 dan pastikan koneksi RS485 normal.");
  } else if (idle) {
    items.push(make("furnace", "Tungku", "BELUM ADA TANDA PANAS PEMBAKARAN", "info",
      "Tungku terbaca " + fmt(furnace, "°C") + ", masih di bawah batas awal pantauan " + fmt(thresholds.transitionTemp, "°C") + ".",
      num(ambient) && Math.abs(furnace - ambient) < 15
        ? "Suhunya dekat dengan udara sekitar " + fmt(ambient, "°C") + ". Ini cocok dengan mesin yang belum dipanaskan."
        : "Suhu rendah tidak membuktikan api pasti padam; keadaan fisik tetap perlu dipastikan.",
      "Jika mesin tidak dipakai, cukup pantau. Jika seharusnya menyala, cek kondisi tungku dan probe."));
  } else if (furnace < thresholds.activeTemp) {
    items.push(make("furnace", "Tungku", "SEDANG MEMANAS / PERALIHAN", "attention",
      "Suhu tungku " + fmt(furnace, "°C") + ", sudah melewati batas awal tetapi belum batas aktif " + fmt(thresholds.activeTemp, "°C") + ".",
      "Ini tahap proses berdasarkan suhu, bukan bukti pembakaran sudah sempurna.",
      "Pantau kenaikan suhu dan ikuti prosedur pengoperasian."));
  } else {
    items.push(make("furnace", "Tungku", "SUHU PEMBAKARAN TERDETEKSI", "info",
      "Tungku menunjukkan " + fmt(furnace, "°C") + ", di atas ambang pemantauan aktif.",
      "Tungku panas tidak berarti gas buang sudah aman atau pembakaran sempurna.",
      "Pantau tren suhu dan parameter gas bersama-sama."));
  }

  // 2. Tren suhu, hanya dari dua pembacaan berdekatan dengan device ID sama.
  if (delta === null || !num(furnace)) {
    items.push(make("trend", "Perubahan suhu", "BELUM BISA DIBANDINGKAN", "unknown",
      "Belum ada dua data yang cukup dekat untuk melihat arah kenaikan atau penurunan.",
      "Perbandingan hanya dilakukan dari perangkat sama, dengan jarak waktu paling lama satu menit.",
      "Tunggu data berikutnya dan perhatikan grafik."));
  } else {
    const state = delta <= -25 ? "TURUN CEPAT" : delta >= 25 ? "NAIK CEPAT" : "BERUBAH PERLAHAN";
    items.push(make("trend", "Perubahan suhu", state, Math.abs(delta) >= 25 ? "attention" : "info",
      "Dari kiriman sebelumnya suhu tungku " + (delta >= 0 ? "naik " : "turun ") + fmt(Math.abs(delta), "°C") + ".",
      "Dua titik saja belum membuktikan kondisi stabil dalam jangka panjang.",
      Math.abs(delta) >= 25 ? "Periksa perubahan proses dan posisi termokopel." : "Perhatikan tren beberapa menit berikutnya."));
    if (delta <= -25) add("Periksa penyebab penurunan suhu tungku yang mendadak.");
  }

  // 3. Cerobong
  if (!num(stack)) {
    items.push(make("stack", "Cerobong", "BELUM TERBACA", "unknown",
      "Suhu cerobong belum tersedia.",
      "Termokopel cerobong ada pada CH4; tanpa angka ini panas pada jalur keluaran belum bisa dipantau.",
      "Cek termokopel CH4 dan sambungan Ebyte."));
    add("Cek probe cerobong CH4 jika suhu tetap tidak muncul.");
  } else if (num(furnace) && stack > furnace + 60) {
    items.push(make("stack", "Cerobong", "SELISIH TIDAK BIASA", "attention",
      "Cerobong " + fmt(stack, "°C") + ", lebih panas 60°C atau lebih dari tungku.",
      "Ini perlu pengecekan posisi probe atau kondisi aliran panas; belum tentu sensornya rusak.",
      "Pastikan probe tungku dan cerobong tidak tertukar."));
    add("Periksa perbedaan suhu tungku dan cerobong serta letak probe.");
  } else if (idle && stack >= thresholds.transitionTemp) {
    items.push(make("stack", "Cerobong", "MASIH PANAS", "attention",
      "Cerobong " + fmt(stack, "°C") + " walau tungku sudah turun.",
      "Bisa terjadi pada tahap pendinginan. Masih panas bukan bukti furan tertentu.",
      "Pantau pendinginan dan jangan menyentuh permukaan panas."));
    add("Pantau cerobong yang masih panas sesuai prosedur keselamatan.");
  } else {
    items.push(make("stack", "Cerobong", "TERBACA", "info",
      "Suhu cerobong sekarang " + fmt(stack, "°C") + ".",
      "Angka ini menunjukkan panas jalur buang, tidak mengukur kandungan zat berbahaya.",
      "Lihat perkembangannya dibanding suhu tungku."));
  }

  // 4. CO dan VOC, tanpa klaim mengukur furan.
  if (warmup || (diag && !gasOK)) {
    items.push(make("gas", "Gas CO dan VOC", warmup ? "MASIH WARM-UP" : "SENSOR BELUM SIAP", "unknown",
      "Modul gas belum menghasilkan pembacaan yang dinyatakan siap.",
      "Nilai yang kosong atau nol ketika modul belum siap tidak boleh dianggap gas benar-benar nol.",
      "Tunggu pembacaan ZEH100 valid dan periksa kabel RS485."));
    add("Pastikan ZEH100 selesai warm-up dan status dataValid sudah benar.");
  } else if (!num(co) || !num(voc)) {
    items.push(make("gas", "Gas CO dan VOC", "DATA BELUM LENGKAP", "unknown",
      "CO atau VOC belum tersedia.",
      "CO membantu memantau pembakaran, VOC mewakili kelompok senyawa organik. Keduanya bukan sensor furan.",
      "Tunggu nilai CO dan VOC yang valid."));
    add("Periksa gas CO dan VOC bila masih tidak terbaca.");
  } else {
    const severe = co >= thresholds.coWarning * 2 || voc >= thresholds.vocWarning * 2;
    const elevated = co >= thresholds.coWarning || voc >= thresholds.vocWarning;
    items.push(make("gas", "Gas CO dan VOC",
      severe ? "NAIK TAJAM" : elevated ? "MELEWATI BATAS PANTAU" : "DI BAWAH AMBANG INTERNAL",
      severe ? "alert" : elevated ? "attention" : "info",
      "CO " + fmt(co, " ppm") + " (batas " + fmt(thresholds.coWarning, " ppm") +
      "), VOC " + fmt(voc, " ppm") + " (batas " + fmt(thresholds.vocWarning, " ppm") + ").",
      severe ? "Ada pembacaan melebihi dua kali ambang internal, perlu pemeriksaan oleh petugas." :
        elevated ? "Ada gas di atas batas pemantauan yang disetel, bukan otomatis melanggar batas emisi resmi." :
        "Gas berada di bawah batas internal. Nilai CO/VOC nol tidak membuktikan furan atau emisi lain nol.",
      elevated ? "Ikuti SOP pemeriksaan gas; jangan jadikan dashboard satu-satunya dasar keputusan keselamatan." :
        "Lihat tren gas secara berkala."));
    if (elevated) add("Periksa CO/VOC yang melewati batas internal sesuai SOP.");
  }

  // 5. Suhu dan kelembapan lingkungan plus hidrogen (no calibrated limit).
  const envFlag = (num(ambient) && ambient >= 50) || (num(humidity) && humidity >= 90);
  items.push(make("environment", "Lingkungan dan H₂", envFlag ? "LINGKUNGAN PERLU DICEK" : "INFORMASI PENDUKUNG",
    envFlag ? "attention" : num(ambient) && num(humidity) ? "info" : "unknown",
    "Udara sekitar: " + (num(ambient) ? fmt(ambient, "°C") : "belum terbaca") +
    "; kelembapan: " + (num(humidity) ? fmt(humidity, "%") : "belum terbaca") +
    "; gas H₂: " + (num(h2) ? fmt(h2, " ppm") : "belum terbaca") + ".",
    "Suhu/kelembapan membantu memantau lingkungan panel. H₂ hanya ditampilkan sebagai angka; belum dipakai menyimpulkan furan atau ambang aman.",
    envFlag ? "Periksa kondisi panas dan lembap sekitar panel." : "Pastikan sensor lingkungan tetap terbaca."));
  if (envFlag) add("Periksa panas atau kelembapan tinggi di sekitar panel.");

  // 6. Report sensor quality; communication error counters are cumulative.
  if (diag) {
    const missing = [
      !diag.cwt.online ? "CWT lingkungan" : null,
      !diag.ebyte.online ? "modul Ebyte" : null,
      !diag.ebyte.ch4Connected ? "probe CH4" : null,
      !diag.ebyte.ch5Connected ? "probe CH5" : null,
      !diag.zeh100.online ? "ZEH100" : null,
      diag.zeh100.online && !diag.zeh100.dataValid ? "data gas belum siap" : null
    ].filter((v): v is string => v !== null);
    items.push(make("sensors", "Kondisi sensor", missing.length ? "PERLU DICEK" : "SEMUA STATUS TERBACA",
      missing.length ? "attention" : "info",
      missing.length ? "Yang perlu diperiksa: " + missing.join(", ") + "." : "CWT, Ebyte CH4/CH5 dan ZEH100 melaporkan data siap.",
      "Error komunikasi sejak boot (kumulatif): CWT " + diag.cwt.errors + ", Ebyte " + diag.ebyte.errors +
        ", ZEH100 " + diag.zeh100.errors + ". Angka error tidak selalu berarti sensor sedang rusak.",
      missing.length ? "Periksa bagian yang disebut dan lihat apakah error terus bertambah." :
        "Lanjutkan pemantauan. Status online sendiri belum membuktikan kalibrasi akurat."));
    if (missing.length) add("Cek status sensor melalui /status pada EG118.");
  } else {
    items.push(make("sensors", "Kondisi sensor", "DETAIL BELUM TERSEDIA", "unknown",
      "Ada angka masuk, tetapi gateway belum menyertakan status masing-masing sensor.",
      "Tanpa diagnostik, kita tidak dapat memastikan koneksi setiap sensor hanya dari adanya sebuah angka.",
      "Gunakan firmware yang menyertakan status cwt, ebyte dan zeh100."));
  }

  // 7. Furan score is an experimental process index, never a measurement.
  items.push(make("furan", "Indikator proses furan",
    lot.furanIndex === null ? "TIDAK DINILAI" : "INDEKS EKSPERIMEN",
    lot.furanIndex === null ? "unknown" : lot.furanIndex >= thresholds.riskWarning ? "attention" : "info",
    lot.furanIndex === null
      ? idle ? "Tungku belum menunjukkan suhu pembakaran, jadi sistem sengaja tidak memberi skor furan."
        : "Parameter belum mencukupi untuk menghitung indikator proses."
      : "Skor internal " + lot.furanIndex + "/100 dihitung dari suhu, CO, VOC, dan perubahannya.",
    "Tidak ada sensor furan langsung. Skor ini bukan kadar furan, bukan persentase kemungkinan emisi, dan tidak membuktikan aman/tidak aman. Skor kosong juga bukan berarti furan nol.",
    "Untuk keputusan emisi, gunakan pengambilan sampel dan analisis laboratorium yang sesuai."));

  // 8. Data source and completeness
  const count = ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"]
    .filter(k => num(current[k as keyof Telemetry] as number | null | undefined)).length;
  items.push(make("quality", "Asal dan kelengkapan data",
    virtual ? "DATA SIMULASI" : count < 7 ? "BELUM LENGKAP" : "KIRIMAN DITERIMA",
    virtual ? "attention" : count < 7 ? "unknown" : "info",
    count + " dari 8 parameter numerik tersedia. ID pengirim " + current.deviceId + ".",
    virtual ? "Identitas ini menunjukkan data simulasi, bukan hasil penelitian lapangan." :
      "Waktu diambil saat server menerima data. Sensor asap numerik belum tersedia; nilai kosong tidak berarti tidak ada asap.",
    virtual ? "Hentikan sender virtual sebelum pencatatan lapangan." :
      "Pastikan waktu terbaru, status sensor, dan kalibrasi sebelum memakai data."));
  if (virtual) add("Hentikan sender simulasi agar tidak tercampur dengan data nyata.");

  const hasCritical = lot.events.some(e => e.severity === "critical");
  const headline = hasCritical ? "Ada pembacaan yang perlu segera diperiksa petugas." :
    lot.events.length ? "Ada kondisi yang perlu dicek dari pembacaan terbaru." :
    idle ? "Suhu tungku masih rendah; pembakaran belum terindikasi dari suhu." :
    "Alat sedang mengirim data; lihat suhu dan gas secara bersamaan.";
  if (!actions.length) add("Terus pantau tren dan pastikan kiriman berikutnya tetap masuk.");
  return {
    headline,
    subheading: virtual ? "PERHATIAN: Data ini berasal dari simulasi, bukan sensor lapangan." :
      "Ini penjelasan sederhana dari angka terbaru, bukan instruksi otomatis menyalakan atau mematikan mesin.",
    note: "Batas suhu dan gas adalah setelan operator, bukan standar emisi resmi. Penilaian keselamatan harus berdasarkan pemeriksaan lapangan dan prosedur yang sesuai.",
    time: current.receivedAt,
    insights: items,
    actions: actions.slice(0, 5)
  };
}
