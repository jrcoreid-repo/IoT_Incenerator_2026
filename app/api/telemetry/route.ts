import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";
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
  // Hanya operator yang terautentikasi boleh membaca telemetry.
  // POST tetap memakai TELEMETRY_INGEST_KEY untuk pengiriman perangkat ESP.
  const cookieStore = await cookies();
  if (!(await verifySessionToken(cookieStore.get("jr_admin")?.value))) {
    return NextResponse.json(
      { error: "Sesi login diperlukan." },
      { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  }
  try {
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
