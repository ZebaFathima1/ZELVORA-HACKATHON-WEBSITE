export function requireWorker(request: Request) {
  const expected = Deno.env.get("AI_WORKER_SECRET");
  const received = request.headers.get("x-worker-secret");
  if (!expected || !received || expected.length !== received.length) {
    throw new Error("AI_WORKER_AUTH_REQUIRED");
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  if (difference !== 0) throw new Error("AI_WORKER_AUTH_REQUIRED");
}
