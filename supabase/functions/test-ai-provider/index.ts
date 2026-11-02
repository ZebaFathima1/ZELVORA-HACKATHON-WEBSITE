import { corsHeaders, isOptions, json } from "../_shared/http.ts";
import { requireAdmin, serviceClient } from "../_shared/supabase.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabase = serviceClient();
    await requireAdmin(request, supabase);

    const apiKey = Deno.env.get("AI_PROVIDER_API_KEY");
    if (!apiKey) return json({ error: "AI_PROVIDER_API_KEY is not configured in Supabase function secrets." }, 503);

    const apiBase = (Deno.env.get("AI_PROVIDER_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = Deno.env.get("AI_MODEL") ?? "gpt-4o-mini";
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 20,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return only a JSON object with the property status set to ZELVORA_AI_READY." },
          { role: "user", content: "Connection test." }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.error("AI provider connection test failed with HTTP status:", response.status);
      return json({ error: `AI provider request failed (HTTP ${response.status}). Check the provider URL, API key, and model secret.` }, 502);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return json({ error: "The AI provider responded, but did not return a structured chat completion." }, 502);
    }

    let result: unknown;
    try {
      result = JSON.parse(content);
    } catch {
      return json({ error: "The AI provider responded, but its output was not valid JSON. Check model support for JSON response format." }, 502);
    }
    if (!isRecord(result) || result.status !== "ZELVORA_AI_READY") {
      return json({ error: "The AI provider responded, but the connection test did not return the expected result." }, 502);
    }

    return json({ ready: true, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI provider connection test failed.";
    console.error("AI provider connection test failed:", error);
    const status = message === "ADMIN_AUTH_REQUIRED" ? 401 : message === "ADMIN_ACCESS_REQUIRED" ? 403 : 500;
    return json({ error: status === 500 ? "Could not test the AI provider. Check the Supabase Function logs." : "Administrator access is required." }, status);
  }
});
