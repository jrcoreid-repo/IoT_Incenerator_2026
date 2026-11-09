import { redirect } from "next/navigation";
import { currentSession } from "@/lib/current-session";
import DashboardShell from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const session = await currentSession();
  if (!session || session.role !== "admin") redirect("/login");
  return <DashboardShell mode="admin" username={session.sub} />;
}
