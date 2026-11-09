import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { parseTelemetry } from "@/lib/telemetry";
import { appendTelemetry, readTelemetry, isStorageReady } from "@/lib/telemetry-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secureMatch(a: string, b: string) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function GET() {
  // Admin and enabled operator may READ telemetry. Disabled/reset operator
  // accounts are rejected immediately, regardless of signed cookie expiry.
  // POST continues to require separate ESP32 TELEMETRY_INGEST_KEY.
  try {
    const session = await currentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi login diperlukan." }, {
        status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" }
      });
    }
    const result = await readTelemetry();
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return NextResponse.json(
      { error: "Data telemetry tidak dapat dibaca." },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }
}

export async function POST(request: Request) {
  const key = process.env.TELEMETRY_INGEST_KEY;
  if (!key || key.length < 24) {
    return NextResponse.json({ error: "Kunci penerimaan data belum dikonfigurasi." }, { status: 503 });
  }
  if (!secureMatch(request.headers.get("authorization") ?? "", `Bearer ${key}`)) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 401 });
  }
  if (!isStorageReady()) {
    return NextResponse.json({ error: "Penyimpanan produksi belum dikonfigurasi." }, { status: 503 });
  }
  if (Number(request.headers.get("content-length") ?? "0") > 4096) {
    return NextResponse.json({ error: "Ukuran payload terlalu besar." }, { status: 413 });
  }
  try {
    const body = await request.json() as unknown;
    const telemetry = parseTelemetry(body);
    if (!telemetry) {
      return NextResponse.json({ error: "Parameter tidak valid. Gunakan angka dan sedikitnya satu field sensor." }, { status: 400 });
    }
    await appendTelemetry(telemetry);
    return NextResponse.json({ ok: true, deviceId: telemetry.deviceId, receivedAt: telemetry.receivedAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Data tidak dapat disimpan." }, { status: 503 });
  }
}
