#!/usr/bin/env node
/**
 * Deployment preflight for ADI Smart Incinerator.
 * Works offline. NEVER prints secret values or connects to Redis.
 *
 * Usage:
 *   npm run deploy:check                          (reads .env.local)
 *   npm run deploy:check -- --env-file .env.deploy.local
 *
 * For CI/hosting, pass variables in the process environment; the env file is
 * optional when all required values are already set.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const required = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "SESSION_SECRET", "TELEMETRY_INGEST_KEY"];
const redisSettings = ["REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];

function parseFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function report(values) {
  const issues = [];
  const warnings = [];
  for (const key of required) {
    const value = values[key]?.trim();
    if (!value) issues.push(key + " belum terisi.");
    else if (/^(?:your_|replace_|change[_-]?me|todo|example|dummy|test[_-]?key|secret_acak|token_acak)/i.test(value)) {
      issues.push(key + " masih berisi contoh/placeholder.");
    }
  }
  if (values.ADMIN_PASSWORD?.length > 0 && values.ADMIN_PASSWORD.length < 12) {
    issues.push("ADMIN_PASSWORD wajib minimal 12 karakter.");
  }
  if (values.SESSION_SECRET?.length > 0 && values.SESSION_SECRET.length < 32) {
    issues.push("SESSION_SECRET wajib minimal 32 karakter.");
  }
  if (values.TELEMETRY_INGEST_KEY?.length > 0 && values.TELEMETRY_INGEST_KEY.length < 24) {
    issues.push("TELEMETRY_INGEST_KEY wajib minimal 24 karakter.");
  }
  if (values.ADMIN_PASSWORD && values.SESSION_SECRET && values.ADMIN_PASSWORD === values.SESSION_SECRET) {
    issues.push("ADMIN_PASSWORD dan SESSION_SECRET harus berbeda.");
  }
  if (values.TELEMETRY_INGEST_KEY && [values.ADMIN_PASSWORD, values.SESSION_SECRET].includes(values.TELEMETRY_INGEST_KEY)) {
    issues.push("TELEMETRY_INGEST_KEY harus berbeda dari kredensial login.");
  }
  const local = values.REDIS_URL?.trim();
  const upstashUrl = values.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = values.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (local) {
    try {
      const url = new URL(local);
      if (url.protocol !== "redis:" ||
          !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
          url.username || url.password || url.search || url.hash ||
          !/^\\/(?:[0-9]+)?$/.test(url.pathname)) {
        issues.push("REDIS_URL wajib redis://127.0.0.1:6379 (hanya loopback; jangan expose Redis ke internet).");
      }
    } catch {
      issues.push("REDIS_URL bukan URL valid.");
    }
    if (upstashUrl || upstashToken) issues.push("Gunakan REDIS_URL ATAU Upstash, jangan keduanya dalam satu server.");
  } else {
    if (!upstashUrl) issues.push("Konfigurasi database belum ada: isi REDIS_URL lokal atau UPSTASH_REDIS_REST_URL.");
    if (!upstashToken) issues.push("UPSTASH_REDIS_REST_TOKEN belum terisi (atau gunakan REDIS_URL lokal).");
    if (upstashUrl) {
      try {
        const url = new URL(upstashUrl);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
          issues.push("UPSTASH_REDIS_REST_URL harus berupa URL HTTPS REST Redis tanpa kredensial/query.");
        }
      } catch {
        issues.push("UPSTASH_REDIS_REST_URL bukan URL valid.");
      }
    }
  }
  if (values.SESSION_SECRET && values.SESSION_SECRET.length >= 32 && /^([a-z0-9])\1+$/i.test(values.SESSION_SECRET)) {
    issues.push("SESSION_SECRET terlalu mudah ditebak.");
  }
  if (values.ADMIN_USERNAME && /^(admin|administrator)$/i.test(values.ADMIN_USERNAME)) {
    warnings.push("Username admin umum; pertimbangkan username unik dan rate limiting di hosting.");
  }
  warnings.push("Pemeriksaan ini hanya memeriksa konfigurasi, bukan koneksi Redis, sertifikat, atau kesiapan keamanan publik.");
  return { issues, warnings };
}

function main() {
  const argIndex = process.argv.indexOf("--env-file");
  const argPath = argIndex >= 0 ? process.argv[argIndex + 1] : ".env.local";
  if (argIndex >= 0 && (!argPath || argPath.startsWith("--"))) {
    console.error("Cara pakai: npm run deploy:check -- --env-file <nama-file>");
    process.exitCode = 2;
    return;
  }
  const filename = resolve(process.cwd(), argPath);
  const fileValues = existsSync(filename) ? parseFile(readFileSync(filename, "utf8")) : {};
  const settings = [...required, ...redisSettings];
  const values = { ...fileValues, ...Object.fromEntries(settings.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])) };
  const { issues, warnings } = report(values);
  console.log("ADI deployment preflight (tanpa mencetak nilai rahasia)");
  console.log("Konfigurasi: " + (existsSync(filename) ? argPath : "environment variables"));
  for (const issue of issues) console.error("FAIL: " + issue);
  for (const warning of warnings) console.warn("NOTE: " + warning);
  if (issues.length) {
    console.error("Belum siap untuk deployment: " + issues.length + " pemeriksaan gagal.");
    process.exitCode = 1;
  } else {
    console.log("PASS: variabel wajib tersedia dan format dasar valid.");
    console.log("Lanjutkan uji login, Redis, POST ESP, dan pembatasan akses sebelum publik.");
  }
}

main();
