import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase function secrets are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireAdmin(request: Request, supabase: ReturnType<typeof serviceClient>) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("ADMIN_AUTH_REQUIRED");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("ADMIN_AUTH_REQUIRED");
  const { data: admin, error: roleError } = await supabase
    .from("admin_users")
    .select("role")
    .eq("user_uuid", user.id)
    .maybeSingle();
  if (roleError || !admin) throw new Error("ADMIN_ACCESS_REQUIRED");
  return { user, role: admin.role as string };
}
