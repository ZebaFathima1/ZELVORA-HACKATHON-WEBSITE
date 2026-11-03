type FunctionError = {
  name?: string;
  message: string;
  context?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getFunctionErrorMessage(error: FunctionError): Promise<string> {
  if (error.name === "FunctionsFetchError") {
    return "Could not reach the Supabase Edge Function. Check the project URL and public key, deploy the function, and confirm its allowed origin includes this website.";
  }

  const context = error.context;
  if (!isRecord(context)) return error.message;

  const status = typeof context.status === "number" ? context.status : undefined;
  const readJson = context.json;
  if (typeof readJson === "function") {
    try {
      const detail: unknown = await readJson.call(context);
      if (isRecord(detail) && typeof detail.error === "string") {
        return status ? `${detail.error} (HTTP ${status})` : detail.error;
      }
    } catch {
      // Fall through to status-aware message.
    }
  }

  if (status === 401) return "Administrator sign-in is required to call this Edge Function (HTTP 401).";
  if (status === 403) return "Administrator access is required for this Edge Function (HTTP 403).";
  if (status === 404) return "The Edge Function was not found. Confirm it is deployed (HTTP 404).";
  if (status && status >= 500) return `The Edge Function failed (HTTP ${status}). Check Supabase Function logs.`;

  return error.message;
}
