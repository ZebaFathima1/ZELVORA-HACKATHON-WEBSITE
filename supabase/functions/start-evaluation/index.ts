import { corsHeaders, isOptions, json } from "../_shared/http.ts";

Deno.serve((request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  return json({ error: "This hosted evaluation endpoint is retired. Use start-ai-evaluation." }, 410, request);
});
