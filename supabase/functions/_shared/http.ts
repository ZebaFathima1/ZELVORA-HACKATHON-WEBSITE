const configuredOrigins = (Deno.env.get("ALLOWED_ORIGIN") ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

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

const allowsLocalDevelopment = configuredOrigins.some(isLocalDevelopmentOrigin);

export function corsHeaders(request?: Request) {
  const origin = request?.headers.get("origin");
  const isAllowed = origin && (
    configuredOrigins.includes("*")
    || configuredOrigins.includes(origin)
    || isLocalDevelopmentOrigin(origin)
  );
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin"
  };
  if (configuredOrigins.includes("*") || allowsLocalDevelopment) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!request) {
    headers["Access-Control-Allow-Origin"] = configuredOrigins[0] ?? "*";
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
