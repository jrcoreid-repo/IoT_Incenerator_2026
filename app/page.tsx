import { redirect } from "next/navigation";
import { currentSession } from "@/lib/current-session";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  redirect(session.role === "admin" ? "/admin" : "/dashboard");
}
