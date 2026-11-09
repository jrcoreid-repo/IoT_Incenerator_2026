import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { createOperator, listOperators, normalizeUsername, USERNAME_PATTERN, validPassword } from "@/lib/operator-store";
import { trustedAuthRequest } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers: HEADERS });

export async function GET() {
  try {
    const session = await currentSession();
    if (session?.role !== "admin") return reply("Akses hanya untuk Admin.", 403);
    return NextResponse.json({ users: await listOperators() }, { headers: HEADERS });
  } catch { return reply("Penyimpanan akun belum tersedia.", 503); }
}
export async function POST(request: Request) {
  if (!trustedAuthRequest(request)) return reply("Permintaan ditolak.", 403);
  try {
    const session = await currentSession();
    if (session?.role !== "admin") return reply("Akses hanya untuk Admin.", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply("Gunakan JSON.", 415);
    if (Number(request.headers.get("content-length") ?? "0") > 4096) return reply("Permintaan terlalu besar.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return reply("Permintaan terlalu besar.", 413);
    const body = JSON.parse(raw) as { username?: unknown; password?: unknown };
    if (!body || typeof body.username !== "string" || typeof body.password !== "string") return reply("Masukkan username dan password.", 400);
    const username = normalizeUsername(body.username);
    if (!USERNAME_PATTERN.test(username)) return reply("Username 3–32 karakter; gunakan huruf kecil, angka, titik, _ atau -.", 400);
    if (!validPassword(body.password)) return reply("Password minimal 12 dan maksimal 128 karakter, hindari password umum.", 400);
    if (username === process.env.ADMIN_USERNAME?.toLowerCase()) return reply("Username tersebut digunakan oleh Admin utama.", 409);
    const outcome = await createOperator(username, body.password);
    if (outcome === "exists") return reply("Username sudah dipakai.", 409);
    if (outcome === "full") return reply("Batas 100 akun operator tercapai.", 409);
    return NextResponse.json({ ok: true, username, role: "operator" }, { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof SyntaxError) return reply("Format JSON tidak valid.", 400);
    if (error instanceof Error && error.message === "INVALID_USER_INPUT") return reply("Data akun tidak valid.", 400);
    return reply("Tidak dapat menyimpan akun saat ini.", 503);
  }
}
