import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { LOG_INTERVAL_MS, iterateArchived } from "@/lib/telemetry-store";
import { parseArchiveRange } from "@/lib/archive-range";
import type { Telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ error: "Login diperlukan." }, { status: 401, headers: HEADERS });
    const parsed = parseArchiveRange(new URL(request.url));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400, headers: HEADERS });
    const { fromMs, toMs } = parsed.range;
    // All 10s raw rows are retained for CSV. The chart receives only the last
    // reading in each time bucket (<=300 samples) to stay fast on mobile.
    const bucketMs = Math.max(LOG_INTERVAL_MS, Math.ceil((toMs - fromMs) / (300 * LOG_INTERVAL_MS)) * LOG_INTERVAL_MS);
    const buckets = new Map<number, Telemetry>();
    let total = 0;
    for await (const reading of iterateArchived(fromMs, toMs)) {
      total++;
      const index = Math.floor((Date.parse(reading.receivedAt) - fromMs) / bucketMs);
      buckets.set(index, reading);
    }
    const history = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
    return NextResponse.json({
      history, total, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
      sampledEverySeconds: LOG_INTERVAL_MS / 1000, chartBucketSeconds: bucketMs / 1000,
      retentionDays: 7
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Riwayat belum dapat dibaca." }, { status: 503, headers: HEADERS });
  }
}
