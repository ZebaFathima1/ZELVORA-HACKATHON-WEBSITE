import { corsHeaders, isOptions, json } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !authorization) return json({ error: "Administrator authentication is required." }, 401);

  const response = await fetch(`${supabaseUrl}/functions/v1/evaluate-project`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(request.headers.get("apikey") ? { apikey: request.headers.get("apikey")! } : {})
    },
    body: await request.text()
  });
  return new Response(response.body, { status: response.status, headers: response.headers });
});
