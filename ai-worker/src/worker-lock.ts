import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";

type WorkerLock = { pid?: unknown };

export async function acquireWorkerLock(lockPath: string, pid = process.pid) {
  const writeLock = () => writeFile(lockPath, JSON.stringify({ pid }), { flag: "wx" });
  try {
    await writeLock();
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  let lock: WorkerLock;
  let originalLock = "";
  try {
    originalLock = await readFile(lockPath, "utf8");
    lock = JSON.parse(originalLock) as WorkerLock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeLock();
      return;
    }
    if (!(error instanceof SyntaxError)) throw error;
    lock = {};
  }

  if (typeof lock.pid === "number") {
    try {
      process.kill(lock.pid, 0);
      throw new Error(`Another AI worker process is already running (PID ${lock.pid}).`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        throw new Error(`Another AI worker process is already running (PID ${lock.pid}).`);
      }
      if (error instanceof Error && error.message.startsWith("Another AI worker")) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  const staleLockPath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, staleLockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeLock();
      return;
    }
    throw error;
  }

  try {
    const movedLock = await readFile(staleLockPath, "utf8");
    if (movedLock !== originalLock) {
      try {
        await copyFile(staleLockPath, lockPath, constants.COPYFILE_EXCL);
      } catch (restoreError) {
        if ((restoreError as NodeJS.ErrnoException).code !== "EEXIST") throw restoreError;
      }
      throw new Error("Worker lock changed during stale-lock recovery; start was cancelled.");
    }
    await writeLock();
  } finally {
    await rm(staleLockPath, { force: true });
  }
}

export async function releaseWorkerLock(lockPath: string, pid = process.pid) {
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as WorkerLock;
    if (lock.pid === pid) await rm(lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
