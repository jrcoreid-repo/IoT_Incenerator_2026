import { redirect } from "next/navigation";
import { currentSession } from "@/lib/current-session";
import DashboardShell from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";
export default async function OperatorDashboard() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.role === "admin") redirect("/admin");
  return <DashboardShell mode="operator" username={session.sub} />;
}
