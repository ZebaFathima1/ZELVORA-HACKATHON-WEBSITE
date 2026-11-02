import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/admin-shell";
import { createClient } from "@/lib/supabase/server";
import RegisteredTeamsPage from "../registered-teams";

export default async function RegisteredTeamsRoute() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/organizer");
  const { data: organizer, error } = await supabase.from("admin_users").select("role").eq("user_uuid", user.id).maybeSingle();
  if (error || !organizer) redirect("/organizer");
  return <AdminShell email={user.email ?? "Organizer"} role={organizer.role} basePath="/organizer"><RegisteredTeamsPage /></AdminShell>;
}
