import { NextResponse } from "next/server";
import { currentSession } from "@/lib/current-session";
import { normalizeUsername, updateOperator, USERNAME_PATTERN, validPassword, toView } from "@/lib/operator-store";
import { trustedAuthRequest } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers: HEADERS });

export async function PATCH(request: Request, context: { params: Promise<{ username: string }> }) {
  if (!trustedAuthRequest(request)) return reply("Permintaan ditolak.", 403);
  try {
    const session = await currentSession();
    if (session?.role !== "admin") return reply("Akses hanya untuk Admin.", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply("Gunakan JSON.", 415);
    if (Number(request.headers.get("content-length") ?? "0") > 4096) return reply("Permintaan terlalu besar.", 413);
    const { username: param } = await context.params;
    const username = normalizeUsername(param);
    if (!USERNAME_PATTERN.test(username) || username === process.env.ADMIN_USERNAME?.toLowerCase()) return reply("Akun tidak valid.", 400);
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) return reply("Permintaan terlalu besar.", 413);
    const payload = JSON.parse(text) as { action?: unknown; password?: unknown };
    if (!payload || (payload.action !== "enable" && payload.action !== "disable" && payload.action !== "reset-password")) {
      return reply("Aksi akun tidak valid.", 400);
    }
    if (payload.action === "reset-password" && (typeof payload.password !== "string" || !validPassword(payload.password))) {
      return reply("Password baru harus 12–128 karakter dan bukan password umum.", 400);
    }
    const record = await updateOperator(username, payload.action, payload.password as string | undefined);
    if (!record) return reply("Akun tidak ditemukan.", 404);
    return NextResponse.json({ ok: true, user: toView(record) }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof SyntaxError) return reply("Format JSON tidak valid.", 400);
    if (error instanceof Error && error.message === "INVALID_USER_INPUT") return reply("Data akun tidak valid.", 400);
    return reply("Tidak dapat memperbarui akun saat ini.", 503);
  }
}
