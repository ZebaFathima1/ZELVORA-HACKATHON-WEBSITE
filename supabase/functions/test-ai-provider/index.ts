import { corsHeaders, isOptions, json } from "../_shared/http.ts";

Deno.serve((request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);
  return json({ error: "Hosted AI providers are retired. Check the local Ollama worker status instead." }, 410, request);
});
