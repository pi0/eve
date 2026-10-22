import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveMicrosandboxOptions } from "#execution/sandbox/bindings/microsandbox-options.js";
import {
  writeSessionMetadata,
  resolveMicrosandboxMetadataPath,
} from "#execution/sandbox/bindings/microsandbox-metadata.js";
import { resolveMicrosandboxSessionRootPath } from "#execution/sandbox/bindings/microsandbox-templates.js";

const installed = vi.hoisted(() => ({ module: undefined as unknown }));
vi.mock("#execution/sandbox/bindings/microsandbox-platform.js", async (original) => ({
  ...(await original<object>()),
  assertMicrosandboxPlatformCandidate: async () => {},
}));
vi.mock("#internal/application/optional-package-install.js", async (original) => ({
  ...(await original<object>()),
  importInstalledEnginePackage: async () => installed.module,
}));

function nativeProvider() {
  const vms = new Map<string, ReturnType<typeof vm>>();
  const snapshots = new Map<string, Map<string, Buffer>>([["template", new Map()]]);
  let creations = 0;
  function vm(name: string, files: Map<string, Buffer>) {
    let running = true;
    return {
      name,
      files,
      get running() {
        return running;
      },
      async detach() {},
      async stop() {
        running = false;
      },
      async execWith() {
        return { code: 0, stderr: () => "" };
      },
      fs: () => ({
        exists: async (path: string) => running && files.has(path),
        read: async (path: string) => files.get(path),
        write: async (path: string, content: Uint8Array) => {
          files.set(path, Buffer.from(content));
        },
      }),
      get status() {
        return running ? "running" : "stopped";
      },
      connectWithTimeout: async () => vms.get(name),
      async startDetached() {
        running = true;
        return this;
      },
      async stopWithTimeout() {
        running = false;
      },
      async kill() {
        running = false;
      },
      async remove() {
        vms.delete(name);
      },
    };
  }
  const missing = () => new Error("sandbox not found");
  const module = {
    isInstalled: () => true,
    setup() {},
    MicrosandboxError: Error,
    Sandbox: {
      async get(name: string) {
        const value = vms.get(name);
        if (!value) throw missing();
        return value;
      },
      builder(name: string) {
        let replace = false;
        let snapshot = "template";
        const builder = new Proxy(
          {},
          {
            get(_target, key) {
              if (key === "replace")
                return () => {
                  replace = true;
                  return builder;
                };
              if (key === "fromSnapshot")
                return (value: string) => {
                  snapshot = value;
                  return builder;
                };
              if (key === "createWithPullProgress")
                return async () => {
                  const previous = vms.get(name);
                  if (previous && !replace) throw new Error("sandbox already exists");
                  // microsandbox 0.5.5's replace terminates the old VM before boot.
                  await previous?.stop();
                  const next = vm(name, new Map(snapshots.get(snapshot)));
                  if (++creations === 1)
                    next.files.set("/workspace/alice.txt", Buffer.from("Alice's running work"));
                  vms.set(name, next);
                  return { async *[Symbol.asyncIterator]() {}, awaitSandbox: async () => next };
                };
              return () => builder;
            },
          },
        );
        return builder;
      },
    },
    Snapshot: {
      async get(name: string) {
        if (!snapshots.has(name)) throw missing();
        return {};
      },
      async remove(name: string) {
        snapshots.delete(name);
      },
    },
  };
  return {
    module,
    vms,
    snapshots,
    get creations() {
      return creations;
    },
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("microsandbox concurrent lifecycle", () => {
  it.each(["create", "restore"] as const)(
    "upserts across independent module instances during %s without replacing running work",
    async (operation) => {
      const storagePath = await mkdtemp(join(tmpdir(), "eve-microsandbox-upsert-"));
      roots.push(storagePath);
      const native = nativeProvider();
      installed.module = native.module;
      const context = {
        host: {
          resolveProjectPath: (path: string) => join(storagePath, path),
          loadOptionalPackage: async <T>() => native.module as T,
        },
        session: {
          id: "session",
          auth: { current: null, initiator: null },
          turn: { id: "turn", sequence: 0 },
        },
        storagePath,
      };
      // Separate module caches model separate framework processes; the native
      // provider and metadata are shared, not the framework's active-handle map.
      const firstProcess = await import("#execution/sandbox/bindings/microsandbox-lifecycle.js");
      vi.resetModules();
      const secondProcess = await import("#execution/sandbox/bindings/microsandbox-lifecycle.js");
      const sessionIdentity = firstProcess.microsandboxSessionIdentity(context);
      const metadataPath = resolveMicrosandboxMetadataPath(
        resolveMicrosandboxSessionRootPath(storagePath, sessionIdentity),
      );
      if (operation === "restore") {
        native.snapshots.set(
          "saved-work",
          new Map([["/workspace/alice.txt", Buffer.from("Alice's running work")]]),
        );
        await writeSessionMetadata(metadataPath, {
          version: 2,
          optionsHash: "options",
          sandboxName: "old-vm",
          stateSnapshotName: "saved-work",
        });
      }
      const input = {
        artifact: {
          version: 2 as const,
          image: null,
          optionsHash: "options",
          snapshotName: "template",
        },
        context,
        createIfMissing: true,
        options: resolveMicrosandboxOptions({ setup: { autoInstall: false } }),
        optionsHash: "options",
        providerName: "microsandbox",
        sessionIdentity,
      };
      const [first, second] = await Promise.all([
        firstProcess.createMicrosandboxHandle(input),
        secondProcess.createMicrosandboxHandle(input),
      ]);
      expect(native.creations).toBe(1);
      expect(native.vms.size).toBe(1);
      expect([...native.vms.values()].every((vm) => vm.running)).toBe(true);
      expect(await first.handle.sandbox.readTextFile({ path: "alice.txt" })).toBe(
        "Alice's running work",
      );
      expect(await second.handle.sandbox.readTextFile({ path: "alice.txt" })).toBe(
        "Alice's running work",
      );

      // Cleanup uses the current metadata, not a cached handle from the other process.
      await firstProcess.deleteMicrosandboxSession({ context, sessionIdentity });
      await secondProcess.deleteMicrosandboxSession({ context, sessionIdentity });
      expect(native.vms.size).toBe(0);
      expect(native.snapshots.has("saved-work")).toBe(false);
    },
  );
});
