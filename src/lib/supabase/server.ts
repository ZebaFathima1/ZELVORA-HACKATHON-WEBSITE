import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) {
    throw new Error("Supabase is not configured. Set the project URL and publishable or anon key.");
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set({ name, value, ...options });
            });
          } catch (error) {
            if (error instanceof Error &&
              error.message.includes("Cookies can only be modified in a Server Action or Route Handler")) return;
            throw error;
          }
        }
      }
    }
  );
}
