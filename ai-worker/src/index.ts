import "dotenv/config";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireWorkerLock, releaseWorkerLock } from "./worker-lock.js";

type Config = {
  supabaseUrl: string;
  supabaseKey: string;
  workerSecret: string;
  ollamaUrl: string;
  model: string;
  timeoutMs: number;
  keepAlive: string;
  displayName: string;
};

type EvaluationContext = {
  job_id: string;
  system: string;
  prompt: string;
  images: Array<{ mime_type: string; data: string }>;
  [key: string]: unknown;
};

type ActiveJob = {
  jobId: string;
  retries?: number;
  context?: EvaluationContext;
  result?: unknown;
};

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workerIdPath = join(root, ".worker-id");
const workerLockPath = join(root, ".worker.lock");
const activeJobPath = join(root, ".active-job.json");
const stopFilePath = join(root, ".stop-worker");
const workerVersion = "1.0.0";
let stopping = false;
let ownsWorkerLock = false;
let workerId = "";
let activeJob: ActiveJob | null = null;
let health = { ollamaConnected: false, modelAvailable: false, error: "Worker is starting." };
let config: Config;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Copy ai-worker/.env.example to ai-worker/.env and configure it.`);
  return value;
}

function loadConfig(): Config {
  const supabaseUrl = required("SUPABASE_URL").replace(/\/+$/, "");
  const supabaseKey = required("SUPABASE_ANON_KEY");
  const workerSecret = required("AI_WORKER_SECRET");
  const ollamaUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ollama = new URL(ollamaUrl);
  if (ollama.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(ollama.hostname)) {
    throw new Error("OLLAMA_BASE_URL must use plain HTTP on this computer's loopback interface only.");
  }
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? "900000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 1800000) {
    throw new Error("OLLAMA_TIMEOUT_MS must be between 10000 and 1800000.");
  }
  return {
    supabaseUrl,
    supabaseKey,
    workerSecret,
    ollamaUrl,
    model: process.env.OLLAMA_MODEL?.trim() || "qwen3-vl:8b",
    timeoutMs,
    keepAlive: process.env.OLLAMA_KEEP_ALIVE?.trim() || "10m",
    displayName: process.env.WORKER_DISPLAY_NAME?.trim() || "Zelvora Local Worker"
  };
}

async function loadWorkerId() {
  try {
    const stored = (await readFile(workerIdPath, "utf8")).trim();
    if (/^[0-9a-f-]{36}$/i.test(stored)) return stored;
  } catch {
    // Generate and persist an identity on the first run.
  }
  const generated = randomUUID();
  await writeFile(workerIdPath, generated, { flag: "wx" }).catch(async () => {
    await writeFile(workerIdPath, generated);
  });
  return generated;
}

async function saveActiveJob() {
  if (!activeJob) {
    await rm(activeJobPath, { force: true });
    return;
  }
  const temporary = `${activeJobPath}.tmp`;
  await writeFile(temporary, JSON.stringify({
    jobId: activeJob.jobId,
    ...(activeJob.retries ? { retries: activeJob.retries } : {}),
    ...(activeJob.result !== undefined ? { result: activeJob.result } : {})
  }));
  await rename(temporary, activeJobPath);
}

async function loadActiveJob(): Promise<ActiveJob | null> {
  try {
    const value: unknown = JSON.parse(await readFile(activeJobPath, "utf8"));
    if (typeof value === "object" && value !== null &&
      typeof (value as ActiveJob).jobId === "string" &&
      ((value as ActiveJob).retries === undefined ||
        (Number.isInteger((value as ActiveJob).retries) && (value as ActiveJob).retries! >= 0))) {
      return value as ActiveJob;
    }
    throw new Error("Saved active job state is invalid.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function api(action: string, values: Record<string, unknown> = {}, timeoutMs = 120000) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/ai-worker-control`, {
    method: "POST",
    headers: {
      apikey: config.supabaseKey,
      "Content-Type": "application/json",
      "x-worker-secret": config.workerSecret
    },
    body: JSON.stringify({ action, worker_id: workerId, ...values }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Supabase worker API returned HTTP ${response.status} with a non-JSON response.`);
  }
  if (!response.ok) {
    const detail = typeof payload.error === "string" ? payload.error : "Supabase worker API failed.";
    throw new Error(`${detail} (HTTP ${response.status}).`);
  }
  return payload;
}

async function ollamaTags() {
  const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status} from /api/tags.`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null ||
    !Array.isArray((payload as { models?: unknown }).models)) {
    throw new Error("Ollama returned an invalid model list.");
  }
  const models = (payload as { models: Array<{ name?: unknown }> }).models;
  const available = models.some((item) => typeof item.name === "string" &&
    (item.name === config.model || item.name.startsWith(`${config.model}:`)));
  return available;
}

async function ollamaGenerate(prompt: string) {
  const response = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      keep_alive: config.keepAlive,
      options: { num_predict: 32, temperature: 0 }
    }),
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if (!response.ok) throw new Error(`Ollama model smoke test failed (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null ||
    typeof (payload as { response?: unknown }).response !== "string" ||
    !(payload as { response: string }).response.trim()) {
    throw new Error("Ollama model smoke test returned no generated text.");
  }
}

async function checkHealth(runSmokeTest = false) {
  let ollamaConnected = false;
  try {
    const modelInstalled = await ollamaTags();
    ollamaConnected = true;
    if (!modelInstalled) throw new Error(`Model ${config.model} is not installed. Run: ollama pull ${config.model}`);
    if (runSmokeTest || !health.modelAvailable) {
      await ollamaGenerate("Reply with the single word READY.");
    }
    health = { ollamaConnected: true, modelAvailable: true, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ollama health check failed.";
    health = {
      ollamaConnected,
      modelAvailable: false,
      error: message
    };
  }
  return health;
}

async function heartbeat(status?: "idle" | "processing" | "error") {
  return api("heartbeat", {
    display_name: config.displayName,
    model_name: config.model,
    ollama_connected: health.ollamaConnected,
    model_available: health.modelAvailable,
    status: status ?? (activeJob ? "processing" : health.error ? "error" : "idle"),
    current_job_id: activeJob?.jobId ?? null,
    last_error: health.error || null,
    worker_version: workerVersion
  });
}

function parseJson(content: string): unknown {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const code = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (code) return JSON.parse(code[1]);
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error("Ollama returned invalid JSON.");
  }
}

async function ollamaEvaluate(context: EvaluationContext) {
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      format: "json",
      keep_alive: config.keepAlive,
      messages: [
        { role: "system", content: context.system },
        {
          role: "user",
          content: context.prompt,
          ...(context.images.length ? { images: context.images.map((image) => image.data) } : {})
        }
      ],
      options: { num_ctx: 32768, num_predict: 4096, temperature: 0.1 }
    }),
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if (!response.ok) throw new Error(`Ollama evaluation failed (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null ||
    typeof (payload as { message?: { content?: unknown } }).message?.content !== "string") {
    throw new Error("Ollama returned no evaluation content.");
  }
  return parseJson((payload as { message: { content: string } }).message.content);
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function processJob(jobId: string, context?: EvaluationContext) {
  const job: ActiveJob = {
    ...(activeJob?.jobId === jobId ? activeJob : {}),
    jobId,
    ...(context ? { context } : {})
  };
  activeJob = job;
  await saveActiveJob();
  let leaseError: string | null = null;
  const renewTimer = setInterval(() => {
    void api("renew", { job_id: jobId }).catch((error: unknown) => {
      leaseError = error instanceof Error ? error.message : "Could not renew the active job lease.";
    });
  }, 30000);

  try {
    if (job.result === undefined) {
      await api("progress", { job_id: jobId, stage: "analyzing_presentation" });
      if (!job.context) {
        const payload = await api("context", { job_id: jobId }, 180000);
        job.context = payload as unknown as EvaluationContext;
      }
      await saveActiveJob();
    }
    while (!stopping) {
      if (existsSync(stopFilePath)) {
        await rm(stopFilePath, { force: true });
        await shutdown("stop-file");
        break;
      }
      if (leaseError) throw new Error(leaseError);
      if (job.result === undefined && (!health.ollamaConnected || !health.modelAvailable)) {
        await checkHealth(true);
        await heartbeat(health.error ? "error" : "processing").catch(() => undefined);
        await delay(5000);
        continue;
      }

      try {
        if (job.result !== undefined) {
          const saved = await api("complete", { job_id: jobId, result: job.result });
          console.log(`Completed recovered job ${jobId} with score ${saved.score}.`);
          activeJob = null;
          await saveActiveJob();
          return;
        }
        await api("progress", { job_id: jobId, stage: "cross_verifying" });
        const result = await ollamaEvaluate(job.context!);
        job.result = result;
        await saveActiveJob();
        await api("progress", { job_id: jobId, stage: "calculating_score" });
        const saved = await api("complete", { job_id: jobId, result });
        console.log(`Completed job ${jobId} with score ${saved.score}.`);
        activeJob = null;
        await saveActiveJob();
        return;
      } catch (error) {
        if (leaseError) throw new Error(leaseError);
        const message = error instanceof Error ? error.message : "Evaluation request failed.";
        if (job.result !== undefined && message.includes("WORKER_JOB_LEASE_LOST")) {
          console.warn("Completed model output lost its lease; the queue will safely reassign the job.");
          activeJob = null;
          await saveActiveJob();
          return;
        }
        if (job.result !== undefined && /context expired/i.test(message)) {
          await api("context", { job_id: jobId }, 180000);
        }
        const networkFailure = /fetch failed|ECONNREFUSED|ETIMEDOUT|timeout|timed out|AbortError|UND_ERR_CONNECT_TIMEOUT|HTTP (?:429|5\d\d)/i.test(message);
        if (job.result === undefined) {
          const currentRetry = (job.retries ?? 0) + 1;
          job.retries = currentRetry;
          await saveActiveJob();
          if (currentRetry >= 3) {
            await api("fail", { job_id: jobId, error: message });
            activeJob = null;
            await saveActiveJob();
            return;
          }
          if (networkFailure) {
            console.warn("Ollama is temporarily unavailable; retrying the leased job:", message);
            await checkHealth(true);
            await heartbeat("error").catch(() => undefined);
          } else {
            console.warn("Evaluation attempt failed; retrying:", message);
          }
        } else {
          if (/HTTP 422/.test(message)) {
            const currentRetry = (job.retries ?? 0) + 1;
            job.retries = currentRetry;
            await saveActiveJob();
            if (currentRetry >= 3) {
              await api("fail", { job_id: jobId, error: `Model output failed validation: ${message}` });
              activeJob = null;
              await saveActiveJob();
              return;
            }
          } else {
            console.error("Could not save completed model output yet; retaining it locally for retry:", message);
          }
        }
        await delay(5000);
      }
    }
  } finally {
    clearInterval(renewTimer);
  }
}

async function recoverActiveJob() {
  if (!activeJob) return false;
  try {
    await api("renew", { job_id: activeJob.jobId });
    await processJob(activeJob.jobId, activeJob.context);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saved job could not be resumed.";
    if (message.includes("lease") || message.includes("WORKER_JOB_LEASE_LOST")) {
      console.warn("Saved job lease expired; the queue will safely reassign it.");
      activeJob = null;
      await saveActiveJob();
      return false;
    }
    console.error("Could not recover the saved job yet:", message);
    return false;
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping after the current request. Unfinished jobs remain leased for safe recovery.`);
  await saveActiveJob().catch((error) => console.error("Could not save worker state:", error));
}

async function main() {
  config = loadConfig();
  await acquireWorkerLock(workerLockPath);
  ownsWorkerLock = true;
  workerId = await loadWorkerId();
  if (existsSync(stopFilePath)) await rm(stopFilePath, { force: true });
  activeJob = await loadActiveJob();
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  console.log(`Starting ${config.displayName} (${workerId}) using ${config.model}.`);

  const startupRenewTimer = activeJob
    ? setInterval(() => {
      void api("renew", { job_id: activeJob!.jobId }).catch((error: unknown) =>
        console.error("Could not renew recovered job during Ollama startup:", error instanceof Error ? error.message : error));
    }, 30000)
    : undefined;
  try {
    health = await checkHealth(true);
  } finally {
    if (startupRenewTimer) clearInterval(startupRenewTimer);
  }
  await heartbeat(health.error ? "error" : "idle");
  if (health.error) console.warn(health.error);

  while (!stopping) {
    if (existsSync(stopFilePath)) {
      await rm(stopFilePath, { force: true });
      await shutdown("stop-file");
      break;
    }
    await checkHealth(false);
    await heartbeat(health.error ? "error" : activeJob ? "processing" : "idle").catch((error: unknown) => {
      console.error("Supabase heartbeat failed:", error instanceof Error ? error.message : error);
    });

    if (activeJob) {
      await recoverActiveJob();
      continue;
    }
    if (!health.ollamaConnected || !health.modelAvailable) {
      await delay(5000);
      continue;
    }

    try {
      const claimed = await api("claim");
      if (!claimed.job || typeof claimed.job !== "object" ||
        typeof (claimed.job as { id?: unknown }).id !== "string") {
        await delay(3000);
        continue;
      }
      const jobId = (claimed.job as { id: string }).id;
      await processJob(jobId);
    } catch (error) {
      console.error("Worker poll failed:", error instanceof Error ? error.message : error);
      await delay(5000);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Worker startup failed.");
  process.exitCode = 1;
}).finally(async () => {
  if (ownsWorkerLock) {
    await releaseWorkerLock(workerLockPath).catch((error: unknown) =>
      console.error("Could not remove worker lock:", error));
  }
});
