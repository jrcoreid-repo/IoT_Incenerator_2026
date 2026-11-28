import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { readThresholds, saveThresholds, validateThresholds } from "@/lib/shared-thresholds";
import { trustedAuthRequest } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers: HEADERS });

export async function GET() {
  try {
    if (!(await currentSession())) return reply("Login diperlukan.", 401);
    const thresholds = await readThresholds();
    return NextResponse.json({ thresholds }, { headers: HEADERS });
  } catch { return reply("Konfigurasi pemantauan tidak dapat dibaca.", 503); }
}
export async function PUT(request: Request) {
  if (!trustedAuthRequest(request)) return reply("Permintaan ditolak.", 403);
  try {
    const session = await currentSession();
    if (session?.role !== "admin") return reply("Pengaturan hanya dapat diubah oleh Admin.", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply("Gunakan JSON.", 415);
    if (Number(request.headers.get("content-length") || 0) > 2048) return reply("Permintaan terlalu besar.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2048) return reply("Permintaan terlalu besar.", 413);
    const data: unknown = JSON.parse(raw);
    if (!validateThresholds(data)) return reply("Nilai ambang tidak valid.", 400);
    await saveThresholds(data);
    return NextResponse.json({ ok: true, thresholds: data }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof SyntaxError) return reply("Format JSON tidak valid.", 400);
    return reply("Tidak dapat menyimpan pengaturan.", 503);
  }
}
