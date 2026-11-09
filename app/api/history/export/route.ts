import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { iterateArchived } from "@/lib/telemetry-store";
import { parseArchiveRange } from "@/lib/archive-range";
import { sensorKeys, type Telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: HEADERS });

// Escape potentially dangerous spreadsheet formulas only for string columns.
// Numerical negative measurements must remain numeric for scientific analysis.
function safeCsvText(value: string) {
  const protectedValue = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + protectedValue.replace(/"/g, '""') + '"';
}
function formatRow(item: Telemetry) {
  return [
    safeCsvText(item.receivedAt),
    safeCsvText(item.deviceId),
    ...sensorKeys.map(key => item[key] === null ? "" : String(item[key]))
  ].join(",") + "\r\n";
}

export async function GET(request: Request) {
  let session;
  try { session = await currentSession(); }
  catch { return error("Penyimpanan autentikasi tidak tersedia.", 503); }
  if (!session) return error("Login diperlukan.", 401);
  // Large research downloads are restricted to the Admin; Operators see charts.
  if (session.role !== "admin") return error("Ekspor data hanya untuk Admin.", 403);
  const parsed = parseArchiveRange(new URL(request.url));
  if ("error" in parsed) return error(parsed.error, 400);

  const { fromMs, toMs } = parsed.range;
  const iterator = iterateArchived(fromMs, toMs);
  const encoder = new TextEncoder();
  let first = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (request.signal.aborted) { controller.close(); return; }
      try {
        if (first) {
          controller.enqueue(encoder.encode("\uFEFF" + ["received_at_utc", "device_id", ...sensorKeys].join(",") + "\r\n"));
          first = false;
          return;
        }
        let body = "";
        for (let i = 0; i < 400; i++) {
          const next = await iterator.next();
          if (next.done) {
            if (body) controller.enqueue(encoder.encode(body));
            controller.close();
            return;
          }
          body += formatRow(next.value);
        }
        controller.enqueue(encoder.encode(body));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() { await iterator.return?.(undefined); }
  });

  const filename = `adi-telemetry-${new Date(fromMs).toISOString().slice(0, 10)}-to-${new Date(toMs).toISOString().slice(0, 10)}.csv`;
  return new Response(stream, {
    status: 200,
    headers: {
      ...HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
