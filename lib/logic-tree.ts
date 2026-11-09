import type { Telemetry, SensorKey } from "./telemetry";

export type Thresholds = {
  activeTemp: number;
  transitionTemp: number;
  coWarning: number;
  vocWarning: number;
  riskWarning: number;
};
export const DEFAULT_THRESHOLDS: Thresholds = {
  activeTemp: 180,
  transitionTemp: 90,
  coWarning: 50,
  vocWarning: 75,
  riskWarning: 50
};
export type Severity = "normal" | "warning" | "critical" | "unknown";
export type RuleEvent = { code: string; severity: Severity; title: string; detail: string };
export type LotResult = {
  process: string;
  severity: Severity;
  furanIndex: number | null;
  furanLevel: string;
  summary: string;
  recommendations: string[];
  rules: string[];
  events: RuleEvent[];
  validSensorCount: number;
};

const numberAvailable = (value: number | null): value is number => value !== null && Number.isFinite(value);
const clamp = (number: number) => Math.min(100, Math.max(0, Math.round(number)));
const level = (value: number) => value >= 75 ? "KRITIS" : value >= 50 ? "TINGGI" : value >= 25 ? "WASPADA" : "RENDAH";

export function evaluateLoT(
  current: Telemetry | null,
  previous: Telemetry | null,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  fresh = true
): LotResult {
  if (!current || !fresh) {
    return {
      process: current ? "DATA TIDAK TERBARU" : "MENUNGGU SENSOR",
      severity: "unknown", furanIndex: null, furanLevel: "—",
      summary: current ? "Data terakhir sudah melewati batas kesegaran. Pemeriksaan otomatis dihentikan sampai pembacaan baru diterima." : "Belum ada data dari perangkat. Sambungkan ESP/gateway ke API telemetry untuk mulai pemantauan.",
      recommendations: ["Periksa daya perangkat, koneksi jaringan, dan pengiriman data."],
      rules: ["CONNECTION_REQUIRED"], events: [], validSensorCount: 0
    };
  }

  const rules: string[] = [];
  const events: RuleEvent[] = [];
  const recommendations: string[] = [];
  const count = (Object.keys(current) as SensorKey[]).filter(key =>
    ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"].includes(key) &&
    numberAvailable(current[key])
  ).length;
  let process = "STATUS BELUM TERSEDIA";

  function warn(code: string, title: string, detail: string, critical = false, advice?: string) {
    events.push({ code, title, detail, severity: critical ? "critical" : "warning" });
    rules.push(code);
    if (advice) recommendations.push(advice);
  }

  const furnace = current.furnace;
  const previousFurnace = previous?.furnace ?? null;
  const tempDelta = numberAvailable(furnace) && numberAvailable(previousFurnace) ? furnace - previousFurnace : null;
  if (!numberAvailable(furnace)) {
    process = "SUHU TIDAK TERBACA";
    warn("TEMP_MISSING", "Sensor suhu tungku belum terbaca", "Status proses tidak dapat dipastikan.", false, "Periksa sensor suhu dan koneksi RS485.");
  } else if (furnace >= thresholds.activeTemp) {
    process = "PEMBAKARAN AKTIF"; rules.push("FURNACE_ACTIVE");
  } else if (furnace >= thresholds.transitionTemp && numberAvailable(tempDelta) && tempDelta < -2) {
    process = "PENDINGINAN"; rules.push("FURNACE_COOLING");
  } else if (furnace >= thresholds.transitionTemp) {
    process = "PEMANASAN"; rules.push("FURNACE_HEATING");
  } else {
    process = "TIDAK AKTIF"; rules.push("FURNACE_IDLE");
  }

  if (numberAvailable(current.co)) {
    if (current.co >= thresholds.coWarning * 2) {
      warn("CO_HIGH", "CO meningkat tajam", `CO ${current.co.toFixed(1)} ppm melebihi dua kali ambang internal.`, true, "Periksa kondisi pembakaran dan jalur keluaran gas dengan prosedur keselamatan yang berlaku.");
    } else if (current.co >= thresholds.coWarning) {
      warn("CO_WARNING", "CO di atas ambang", `CO ${current.co.toFixed(1)} ppm melebihi ambang internal.`, false, "Pantau kenaikan CO dan verifikasi proses pembakaran.");
    } else rules.push("CO_BELOW_INTERNAL_THRESHOLD");
  } else {
    rules.push("CO_MISSING");
    recommendations.push("Periksa pembacaan CO sebelum menyimpulkan kondisi gas.");
  }

  if (numberAvailable(current.voc)) {
    if (current.voc >= thresholds.vocWarning * 2) {
      warn("VOC_HIGH", "VOC meningkat tajam", `VOC ${current.voc.toFixed(1)} ppm melebihi dua kali ambang internal.`, true, "Periksa tren gas organik dan kondisi pengoperasian.");
    } else if (current.voc >= thresholds.vocWarning) {
      warn("VOC_WARNING", "VOC di atas ambang", `VOC ${current.voc.toFixed(1)} ppm melebihi ambang internal.`, false, "Periksa pola kenaikan VOC pada grafik.");
    } else rules.push("VOC_BELOW_INTERNAL_THRESHOLD");
  } else {
    rules.push("VOC_MISSING");
    recommendations.push("Pastikan sensor VOC tersedia untuk evaluasi gas.");
  }

  if (numberAvailable(tempDelta)) {
    if (tempDelta <= -25) {
      warn("RAPID_COOLING", "Penurunan suhu", `Suhu tungku turun ${Math.abs(tempDelta).toFixed(1)}°C dibanding pembacaan sebelumnya.`, false, "Periksa kestabilan proses dan suplai udara.");
    } else if (tempDelta >= 25) {
      rules.push("RAPID_HEATING");
    } else rules.push("TEMP_STABLE_TREND");
  }

  if (numberAvailable(current.humidity) && current.humidity >= 90) {
    warn("HUMIDITY_HIGH", "Kelembapan tinggi", "Kelembapan udara sekitar melewati 90%.", false, "Periksa kondisi lingkungan dan perlindungan panel elektronik.");
  }
  if (numberAvailable(current.ambient) && current.ambient >= 50) {
    warn("AMBIENT_HIGH", "Suhu lingkungan tinggi", "Suhu lingkungan sekitar melebihi 50°C.", false, "Periksa pendinginan dan ventilasi panel.");
  }
  if (numberAvailable(current.stack) && numberAvailable(furnace) && current.stack > furnace + 60) {
    warn("STACK_TEMP_ANOMALY", "Perbandingan suhu tidak biasa", "Suhu cerobong melebihi suhu tungku secara signifikan.", false, "Periksa posisi sensor dan pembacaan termokopel.");
  }

  // LoT: indikator proses, bukan konsentrasi dioksin/furan dan belum tervalidasi ilmiah.
  // Sengaja hanya dihitung bila suhu tungku, CO dan VOC tersedia.
  let furanIndex: number | null = null;
  if (numberAvailable(furnace) && numberAvailable(current.co) && numberAvailable(current.voc)) {
    let points = 8;
    if (furnace < thresholds.transitionTemp) { points += 26; rules.push("FURAN_T_LOW"); }
    else if (furnace < thresholds.activeTemp) { points += 18; rules.push("FURAN_T_TRANSITION"); }
    else { rules.push("FURAN_T_ACTIVE"); }
    if (current.co >= thresholds.coWarning * 2) { points += 27; rules.push("FURAN_CO_HIGH"); }
    else if (current.co >= thresholds.coWarning) { points += 17; rules.push("FURAN_CO_WARN"); }
    else { points += 4; }
    if (current.voc >= thresholds.vocWarning * 2) { points += 27; rules.push("FURAN_VOC_HIGH"); }
    else if (current.voc >= thresholds.vocWarning) { points += 17; rules.push("FURAN_VOC_WARN"); }
    else { points += 4; }
    if (numberAvailable(tempDelta) && tempDelta <= -25) { points += 12; rules.push("FURAN_TEMP_DROP"); }
    if (numberAvailable(current.smoke) && current.smoke >= 0.08) { points += 12; rules.push("FURAN_SMOKE_RISE"); }
    furanIndex = clamp(points);
    if (furanIndex >= thresholds.riskWarning) {
      warn("FURAN_INDEX_WARNING", "Indeks proses perlu diperiksa", `Indeks indikator furan ${furanIndex}/100 melewati ambang internal.`, false, "Periksa tren suhu, CO, dan VOC; validasi emisi menggunakan metode laboratorium.");
    }
  } else {
    rules.push("FURAN_UNAVAILABLE");
  }

  if (events.length === 0) {
    rules.push("NO_INTERNAL_ALERT");
    recommendations.push("Lanjutkan pengamatan tren suhu dan gas. Tidak ada ambang internal yang terlampaui pada data terkini.");
  }
  const severity: Severity = events.some(event => event.severity === "critical") ? "critical" : events.length > 0 ? "warning" : !numberAvailable(furnace) || !numberAvailable(current.co) || !numberAvailable(current.voc) ? "unknown" : "normal";
  const summary = severity === "critical"
    ? "Terdapat pembacaan gas yang meningkat tajam. Periksa proses melalui prosedur operasi dan keselamatan yang berlaku."
    : severity === "warning"
      ? "Beberapa parameter memerlukan pemeriksaan. Rincian kondisi dan tindakan tercantum di bawah."
      : severity === "unknown"
        ? "Parameter penting belum lengkap. Pemeriksaan kondisi gas belum bisa disimpulkan."
        : "Parameter yang tersedia berada di bawah ambang peringatan internal. Lanjutkan pemantauan suhu dan gas secara berkala.";
  return {
    process, severity, furanIndex,
    furanLevel: furanIndex === null ? "TIDAK TERSEDIA" : level(furanIndex),
    summary, rules, events, recommendations: [...new Set(recommendations)].slice(0, 6),
    validSensorCount: count
  };
}
