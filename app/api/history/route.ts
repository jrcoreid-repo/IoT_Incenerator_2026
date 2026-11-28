import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { LOG_INTERVAL_MS, iterateArchived } from "@/lib/telemetry-store";
import { ArchiveChartSampler } from "@/lib/archive-chart-sampler";
import { parseArchiveRange } from "@/lib/archive-range";

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
    // Every archived reading is shown for short tests (<=300 entries).
    // Large ranges are reduced in a single bounded pass, keeping the newest
    // reading and avoiding time buckets that collapse brief sessions to 1 dot.
    const sampler = new ArchiveChartSampler();
    for await (const reading of iterateArchived(fromMs, toMs)) sampler.add(reading);
    const { history, total, chartBucketSeconds, sampled } = sampler.finish();
    return NextResponse.json({
      history, total, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
      sampledEverySeconds: LOG_INTERVAL_MS / 1000, chartBucketSeconds, sampled,
      retentionDays: 7
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Riwayat belum dapat dibaca." }, { status: 503, headers: HEADERS });
  }
}
