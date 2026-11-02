import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/admin-shell";
import AdminDashboard from "@/app/admin/(workspace)/page";
import { OrganizerLogin } from "./organizer-login";
import { createClient } from "@/lib/supabase/server";

export default async function OrganizerPage() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) {
    return <OrganizerLogin initialError="Organizer sign-in is unavailable until the Supabase project URL and publishable key are configured." />;
  }

  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError") {
    return <OrganizerLogin initialError={`Could not check the Supabase session. ${authError.message}`} />;
  }
  if (!user) return <OrganizerLogin />;

  const { data: organizer, error: roleError } = await supabase
    .from("admin_users")
    .select("role")
    .eq("user_uuid", user.id)
    .maybeSingle();

  if (roleError) {
    console.error("Could not verify organizer role:", roleError);
    return <OrganizerLogin initialError={`Could not verify organizer access. Apply the database migration and check the admin_users table. ${roleError.message}`} />;
  }
  if (!organizer) {
    return <OrganizerLogin initialError="Could not find your organizer account. Confirm the latest database migration is applied, then try again." />;
  }

  return (
    <AdminShell email={user.email ?? "Organizer"} role={organizer.role} basePath="/organizer">
      <AdminDashboard />
    </AdminShell>
  );
}
