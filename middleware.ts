import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/admin/login" ? "/organizer" : `/organizer${pathname.slice("/admin".length)}`;
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  if (pathname === "/organizer/reset-password") return response;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
    if (pathname.startsWith("/organizer/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/organizer";
      return NextResponse.redirect(url);
    }
    return response;
  }
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({ name, value: "", ...options });
        }
      }
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (pathname.startsWith("/organizer/") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/organizer";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/organizer/:path*"]
};
