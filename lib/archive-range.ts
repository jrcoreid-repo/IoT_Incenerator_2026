import { RETENTION_MS } from "./telemetry-store";

export type ArchiveRange = { fromMs: number; toMs: number; description: string };
export type ArchiveRangeResult = { range: ArchiveRange } | { error: string };

const DAY = 24 * 60 * 60 * 1000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function parseArchiveRange(url: URL, now = Date.now()): ArchiveRangeResult {
  const days = url.searchParams.get("days");
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  if (days !== null && (fromRaw !== null || toRaw !== null)) {
    return { error: "Pilih jumlah hari ATAU rentang tanggal, tidak keduanya." };
  }

  let fromMs: number;
  let toMs: number;
  if (fromRaw !== null || toRaw !== null) {
    if (!fromRaw || !toRaw || !ISO_UTC.test(fromRaw) || !ISO_UTC.test(toRaw)) {
      return { error: "Rentang khusus harus berupa waktu UTC ISO yang lengkap." };
    }
    fromMs = Date.parse(fromRaw);
    toMs = Date.parse(toRaw);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return { error: "Tanggal tidak valid." };
    }
  } else {
    if (days !== null && !/^[1-7]$/.test(days)) return { error: "Pilih 1 sampai 7 hari." };
    const count = days === null ? 1 : Number(days);
    toMs = now;
    fromMs = now - count * DAY;
  }

  if (toMs <= fromMs) return { error: "Tanggal akhir harus setelah tanggal awal." };
  if (toMs - fromMs > RETENTION_MS) return { error: "Rentang tidak boleh melebihi 7 hari." };
  if (fromMs > now) return { error: "Tidak dapat menampilkan data masa depan." };
  if (toMs < now - RETENTION_MS) return { error: "Data lebih dari 7 hari sudah kedaluwarsa." };

  // Enforce the rolling retention window, even for custom calendar-day queries.
  fromMs = Math.max(fromMs, now - RETENTION_MS);
  toMs = Math.min(toMs, now);
  return { range: { fromMs, toMs, description: `${new Date(fromMs).toISOString()} – ${new Date(toMs).toISOString()}` } };
}
