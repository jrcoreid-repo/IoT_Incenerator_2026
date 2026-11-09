import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Tidak ada lagi halaman pemantauan publik.
export default function HomePage() {
  redirect("/admin");
}
