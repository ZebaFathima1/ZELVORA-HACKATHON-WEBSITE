import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "../admin-shell";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) redirect("/organizer");
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/organizer");
  const { data: admin, error } = await supabase.from("admin_users").select("role").eq("user_uuid", user.id).maybeSingle();
  if (error || !admin) redirect("/organizer");
  return <AdminShell email={user.email ?? "Administrator"} role={admin.role}>{children}</AdminShell>;
}
