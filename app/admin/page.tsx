import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "@/lib/auth";
import DashboardShell from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Defense in depth: walaupun middleware terlewati, server tetap memverifikasi sesi.
  const cookieStore = await cookies();
  if (!(await verifySessionToken(cookieStore.get("jr_admin")?.value))) {
    redirect("/login");
  }
  return <DashboardShell mode="admin" />;
}
