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

  const readJson = context.json;
  if (typeof readJson === "function") {
    try {
      const detail: unknown = await readJson.call(context);
      if (isRecord(detail) && typeof detail.error === "string") return detail.error;
    } catch {
      return error.message;
    }
  }

  return error.message;
}
