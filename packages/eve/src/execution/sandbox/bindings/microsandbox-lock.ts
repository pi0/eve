import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { createSandboxProviderIdentity } from "#execution/sandbox/provider-identity.js";

// A pending promise without an event source does not keep its async frame alive
// for GC. Keep the native connection alive until the operation settles.
const activeLocks = new Set<import("node:sqlite").DatabaseSync>();

/**
 * Serialize one session's native lifecycle transitions across processes,
 * including cleanup. Sessions share a bounded set of lock files, so unrelated
 * sessions rarely wait on each other and lock files never accumulate.
 */
export async function withMicrosandboxLifecycleLock<T>(
  storagePath: string,
  sessionIdentity: string,
  operation: () => Promise<T>,
): Promise<T> {
  // SQLite's OS lock is released on process death. Heartbeat/stale-file locks
  // can admit two owners when a live process pauses, which would destroy a VM.
  // Keep the databases outside session directories and never unlink them:
  // waiters must always lock the same inode, even while cleanup removes a session.
  const directory = join(storagePath, "microsandbox", "locks");
  await mkdir(directory, { recursive: true });
  const stripe = createSandboxProviderIdentity({ sessionIdentity }).slice(0, 2);
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(join(directory, `${stripe}.sqlite`));
  activeLocks.add(database);
  const deadline = Date.now() + 10 * 60_000;
  try {
    for (;;) {
      try {
        database.exec("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");
        if (!(error instanceof Error && "errcode" in error && error.errcode === 5)) throw error;
        if (Date.now() >= deadline) {
          throw new Error(
            "Timed out waiting for another process to finish a microsandbox lifecycle operation.",
            { cause: error },
          );
        }
        await setTimeout(100);
      }
    }
    return await operation();
  } finally {
    // Closing rolls back the empty transaction and releases the OS lock.
    database.close();
    activeLocks.delete(database);
  }
}
