// Runtime validation coverage for the local worker's process lock.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWorkerLock, releaseWorkerLock } from "../ai-worker/src/worker-lock";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("local worker process lock", () => {
  it("preserves a lock owned by a live process", async () => {
    directory = await mkdtemp(join(tmpdir(), "zelvora-worker-lock-"));
    const lockPath = join(directory, ".worker.lock");
    const existingLock = JSON.stringify({ pid: process.pid });
    await writeFile(lockPath, existingLock);

    await expect(acquireWorkerLock(lockPath)).rejects.toThrow("Another AI worker process is already running");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(existingLock);
  });

  it("removes a lock only when the current process owns it", async () => {
    directory = await mkdtemp(join(tmpdir(), "zelvora-worker-lock-"));
    const lockPath = join(directory, ".worker.lock");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid + 1 }));

    await releaseWorkerLock(lockPath);

    await expect(readFile(lockPath, "utf8")).resolves.toBe(JSON.stringify({ pid: process.pid + 1 }));
  });

  it("allows only one process to take over a stale lock", async () => {
    directory = await mkdtemp(join(tmpdir(), "zelvora-worker-lock-"));
    const lockPath = join(directory, ".worker.lock");
    await writeFile(lockPath, JSON.stringify({ pid: 1_000_000_000 }));

    const outcomes = await Promise.allSettled([
      acquireWorkerLock(lockPath, 1_000_000_001),
      acquireWorkerLock(lockPath, 1_000_000_002)
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    expect([1_000_000_001, 1_000_000_002]).toContain(owner.pid);
  });
});
