#!/usr/bin/env node
/**
 * Pengirim virtual ESP32 untuk ADI Smart Incinerator.
 * Menggunakan endpoint dan payload yang sama dengan perangkat ESP32 fisik.
 *
 * Menjalankan:
 *   npm run sender:virtual
 *   npm run sender:virtual -- --scenario warning
 *   npm run sender:virtual -- --scenario cycle --phase-seconds 20
 *   npm run sender:virtual -- --dry-run
 *
 * Membaca TELEMETRY_INGEST_KEY dari environment/.env.local.
 * Berjalan TERPISAH dari server Next.js, hanya saat perintah dijalankan.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const STAGES = ["idle", "heating", "active", "warning", "critical", "cooling"];
export const SCENARIOS = ["cycle", ...STAGES];

const stageTargets = {
  idle:     { furnace: 54,  stack: 41,  ambient: 29.4, humidity: 70, co: 11,  h2: 2.3,  voc: 18,  smoke: 0.012 },
  heating:  { furnace: 149, stack: 84,  ambient: 30.0, humidity: 66, co: 31,  h2: 5.7,  voc: 53,  smoke: 0.030 },
  active:   { furnace: 302, stack: 151, ambient: 31.3, humidity: 64, co: 24,  h2: 6.0,  voc: 37,  smoke: 0.023 },
  warning:  { furnace: 188, stack: 136, ambient: 32.5, humidity: 61, co: 71,  h2: 11.1, voc: 110, smoke: 0.065 },
  critical: { furnace: 156, stack: 142, ambient: 33.8, humidity: 59, co: 132, h2: 18.2, voc: 185, smoke: 0.098 },
  cooling:  { furnace: 98,  stack: 67,  ambient: 30.6, humidity: 66, co: 28,  h2: 5.2,  voc: 47,  smoke: 0.035 }
};
const keys = ["furnace", "stack", "ambient", "humidity", "co", "h2", "voc", "smoke"];

const usage = `
ADI Smart Incinerator · Virtual ESP32 sender

npm run sender:virtual
npm run sender:virtual -- --scenario warning
npm run sender:virtual -- --scenario critical --count 10
npm run sender:virtual -- --scenario cycle --phase-seconds 20
npm run sender:virtual -- --dry-run

Pilihan:
  --scenario <name>       cycle | idle | heating | active | warning | critical | cooling
  --interval <seconds>    Jarak pengiriman, default 3 (minimal 1)
  --phase-seconds <n>     Durasi tiap fase untuk cycle, default 25 (minimal 5)
  --count <n>             Jumlah payload; 0 = terus sampai Ctrl+C (default)
  --url <url>             Endpoint target, default http://localhost:3000/api/telemetry
  --device-id <id>        Identitas pengirim, default ESP32-VIRTUAL-01
  --dry-run               Tampilkan JSON tanpa mengirim ke API
  --help                  Tampilkan bantuan

Set TELEMETRY_INGEST_KEY di .env.local, minimal 24 karakter.
Kirim ke localhost secara bawaan; untuk domain gunakan HTTPS dan --url.
`;

export function parseOptions(argv) {
  const options = {
    scenario: "cycle",
    interval: 3,
    phaseSeconds: 25,
    count: 0,
    url: "http://localhost:3000/api/telemetry",
    deviceId: "ESP32-VIRTUAL-01",
    dryRun: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === "--help" || raw === "-h") { options.help = true; continue; }
    if (raw === "--dry-run") { options.dryRun = true; continue; }
    const aliases = {
      "--scenario": "scenario", "--interval": "interval",
      "--phase-seconds": "phaseSeconds", "--count": "count",
      "--url": "url", "--device-id": "deviceId"
    };
    const [flag, inline] = raw.split(/=(.*)/s, 2);
    const key = aliases[flag];
    if (!key) throw new Error(`Pilihan tidak dikenal: ${raw}. Gunakan --help.`);
    const value = inline ?? argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`Nilai ${flag} tidak ditemukan.`);
    if (["interval", "phaseSeconds", "count"].includes(key)) {
      if (value.trim() === "" || !Number.isFinite(Number(value))) throw new Error(`Nilai ${flag} harus angka.`);
      options[key] = Number(value);
    } else {
      options[key] = value;
    }
  }
  if (!SCENARIOS.includes(options.scenario)) throw new Error("Skenario tidak dikenal. Gunakan --help.");
  if (!Number.isInteger(options.count) || options.count < 0) throw new Error("--count harus bilangan bulat >= 0.");
  if (!Number.isFinite(options.interval) || options.interval < 1 || options.interval > 3600) throw new Error("--interval harus 1–3600 detik.");
  if (!Number.isFinite(options.phaseSeconds) || options.phaseSeconds < 5 || options.phaseSeconds > 3600) throw new Error("--phase-seconds harus 5–3600 detik.");
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(options.deviceId)) throw new Error("--device-id hanya boleh huruf, angka, - atau _ (maksimal 48).");
  let target;
  try { target = new URL(options.url); } catch { throw new Error("URL target tidak valid."); }
  if (target.username || target.password || target.search || target.hash || target.pathname !== "/api/telemetry") {
    throw new Error("Target harus /api/telemetry tanpa kredensial, query, atau fragment.");
  }
  if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) {
    throw new Error("URL non-lokal wajib menggunakan HTTPS.");
  }
  return options;
}

const lerp = (a, b, weight) => a + (b - a) * weight;
function round(value, decimals) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function stageAt(elapsedSeconds, scenario, phaseSeconds) {
  if (scenario !== "cycle") return { name: scenario, from: scenario, progress: 1 };
  const position = Math.floor(elapsedSeconds / phaseSeconds);
  const index = position % STAGES.length;
  const name = STAGES[index];
  const from = STAGES[(index + STAGES.length - 1) % STAGES.length];
  const fraction = (elapsedSeconds % phaseSeconds) / phaseSeconds;
  // Awal fase pertama langsung idle, fase lain berubah bertahap selama 60% durasi.
  const progress = position === 0 ? 1 : clamp(fraction / 0.6, 0, 1);
  return { name, from, progress };
}

export function generatePayload({ scenario = "cycle", phaseSeconds = 25, deviceId = "ESP32-VIRTUAL-01" }, elapsedSeconds = 0) {
  const stage = stageAt(elapsedSeconds, scenario, phaseSeconds);
  const result = { deviceId };
  for (const key of keys) {
    const start = stageTargets[stage.from][key];
    const finish = stageTargets[stage.name][key];
    const mean = lerp(start, finish, stage.progress);
    // Fluktuasi kecil dan kontinu agar grafik tidak sepenuhnya datar.
    const amplitude = key === "smoke" ? 0.002 : key === "ambient" ? 0.16 : key === "humidity" ? 0.6 : 1.4;
    const movement = Math.sin(elapsedSeconds * 0.41 + keys.indexOf(key) * 1.31) * amplitude;
    const value = mean + movement;
    const bounded = key === "humidity" ? clamp(value, 0, 100) : Math.max(0, value);
    result[key] = round(bounded, key === "smoke" ? 3 : 1);
  }
  return { stage: stage.name, payload: result };
}

function loadLocalEnv() {
  if (existsSync(resolve(".env.local")) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(".env.local");
  }
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function send(url, token, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  return response.status;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  loadLocalEnv();
  const token = process.env.TELEMETRY_INGEST_KEY?.trim();
  if (!options.dryRun && (!token || token.length < 24)) {
    throw new Error("TELEMETRY_INGEST_KEY belum diatur (minimal 24 karakter) di .env.local.");
  }
  console.log("\nADI Smart Incinerator / Virtual ESP32 sender");
  console.log(`Target: ${options.url}`);
  console.log(`Device: ${options.deviceId} | Skenario: ${options.scenario} | Interval: ${options.interval}s`);
  if (options.dryRun) {
    for (const name of (options.scenario === "cycle" ? STAGES : [options.scenario])) {
      console.log(`\n[${name.toUpperCase()}] ${JSON.stringify(generatePayload({ ...options, scenario: name }, 4).payload, null, 2)}`);
    }
    console.log("\nTidak ada data dikirim (--dry-run).");
    return;
  }
  console.log("Mengirim pembacaan virtual. Ctrl+C untuk berhenti.\n");
  let sent = 0;
  let failures = 0;
  const start = Date.now();
  let running = true;
  process.once("SIGINT", () => { running = false; console.log("\nPengirim dihentikan."); });
  while (running && (options.count === 0 || sent < options.count)) {
    const time = (Date.now() - start) / 1000;
    const { stage, payload } = generatePayload(options, time);
    try {
      const status = await send(options.url, token, payload);
      failures = 0;
      sent++;
      const now = new Date().toLocaleTimeString("id-ID");
      console.log(`[${now}] #${String(sent).padStart(3,"0")} ${stage.padEnd(8)} ${status} | T=${payload.furnace}°C | CO=${payload.co} ppm | VOC=${payload.voc} ppm`);
    } catch (error) {
      failures++;
      console.error(`Gagal mengirim (${failures}/3): ${error instanceof Error ? error.message : String(error)}`);
      if (failures >= 3) throw new Error("Pengiriman gagal 3 kali. Periksa Next.js, URL, dan TELEMETRY_INGEST_KEY.");
    }
    if (running && (options.count === 0 || sent < options.count)) await sleep(options.interval * 1000);
  }
  console.log(`Selesai: ${sent} pembacaan terkirim.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error("ERROR:", error.message); process.exitCode = 1; });
}
