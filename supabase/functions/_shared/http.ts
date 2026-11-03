/**
 * Explicit CORS allowlist for Edge Functions.
 *
 * Configure ALLOWED_ORIGIN as a comma-separated list of exact origins, e.g.:
 *   http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001
 * Later append production: ,https://your-production-domain.example
 *
 * Never emits wildcard "*".
 * Built-in local fallback also accepts http://localhost|127.0.0.1:(3000|3001).
 * Production HTTPS origins must be listed explicitly in ALLOWED_ORIGIN when deployed.
 */

const configuredOrigins = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Headers the browser Supabase SDK may send on functions.invoke (preflight must allow them). */
const ALLOWED_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-worker-secret",
  "x-supabase-api-version",
  "x-region",
  "x-retry-count",
  "prefer",
  "accept",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "traceparent",
  "tracestate",
  "baggage"
].join(", ");

function isLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname)
      && ["3000", "3001"].includes(url.port);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (configuredOrigins.includes(origin)) return true;
  return isLocalDevelopmentOrigin(origin);
}

export function corsHeaders(request?: Request) {
  const origin = request?.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin"
  };

  // Reflect only an explicitly allowed origin. Never emit "*".
  // Do not set Allow-Credentials: browser calls use Authorization headers, not cookies.
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function json(data: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

export function isOptions(request: Request) {
  return request.method === "OPTIONS";
}

export function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",").pop()?.trim()
    ?? "unknown";
}
