import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { BaseEnvRunner } from "#compiled/env-runner/index.js";
import { resolvePackageCompiledFilePath } from "#internal/application/package.js";
import { toErrorMessage } from "#shared/errors.js";

const DEVELOPMENT_WORKER_SHUTDOWN_TIMEOUT_MS = 15_000;

export interface DevelopmentRunner {
  readonly closed: boolean;
  /** Terminates the worker right away. */
  close(cause?: unknown): Promise<void>;
  fetch(request: Request, init?: RequestInit): Promise<Response>;
  onceClosed(listener: (cause?: unknown) => void): void;
  /** Lets the worker run its close hooks before it is terminated. */
  shutdown(): Promise<void>;
  upgrade(input: {
    readonly node: {
      readonly head: Buffer;
      readonly req: import("node:http").IncomingMessage;
      readonly socket: import("node:net").Socket;
    };
  }): Promise<void>;
  waitForReady(timeout: number): Promise<void>;
}

export interface DevelopmentRunnerInput {
  readonly entry: string;
  readonly name: string;
  readonly workerData: Readonly<Record<string, unknown>>;
}

export type DevelopmentRunnerFactory = (input: DevelopmentRunnerInput) => DevelopmentRunner;

// env-runner's own `NodeWorkerEnvRunner` resolves its worker entry through
// `import.meta.resolve("env-runner/...")`, which fails from eve's vendored copy.
class NodeDevelopmentRunner extends BaseEnvRunner implements DevelopmentRunner {
  readonly #closedListeners = new Set<(cause?: unknown) => void>();
  #worker: Worker | undefined;

  constructor(input: DevelopmentRunnerInput) {
    const workerEntry = resolvePackageCompiledFilePath("src/compiled/env-runner/node-worker.js");
    super({
      data: {
        entry: input.entry,
        ...input.workerData,
      },
      hooks: {
        onClose: (_runner, cause) => {
          const listeners = [...this.#closedListeners];
          this.#closedListeners.clear();
          for (const listener of listeners) {
            listener(cause);
          }
        },
      },
      name: input.name,
      workerEntry,
    });
    this._initWithVirtualData(() => this.#startWorker());
  }

  onceClosed(listener: (cause?: unknown) => void): void {
    if (this.closed) {
      listener(this._closeCause);
      return;
    }
    this.#closedListeners.add(listener);
  }

  override sendMessage(message: unknown): void {
    if (this.#worker === undefined) {
      throw new Error("Development worker is not initialized.");
    }
    this.#worker.postMessage(message);
  }

  override async shutdown(): Promise<void> {
    await super.shutdown(DEVELOPMENT_WORKER_SHUTDOWN_TIMEOUT_MS);
  }

  override async waitForReady(timeout: number): Promise<void> {
    try {
      await super.waitForReady(timeout);
    } catch (error) {
      if (this._closeCause === undefined) {
        throw error;
      }
      throw new Error(
        `Development worker failed before readiness: ${toErrorMessage(this._closeCause)}`,
        { cause: this._closeCause },
      );
    }
  }

  protected override _hasRuntime(): boolean {
    return this.#worker !== undefined;
  }

  protected override _runtimeType(): string {
    return "worker";
  }

  protected override async _closeRuntime(): Promise<void> {
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.removeAllListeners();
    await worker?.terminate();
  }

  #startWorker(): void {
    if (!existsSync(this._workerEntry)) {
      void this.close(new Error(`Development worker entry not found at "${this._workerEntry}".`));
      return;
    }

    const worker = new Worker(this._workerEntry, {
      env: process.env,
      workerData: {
        name: this._name,
        ...this._data,
      },
    });
    this.#worker = worker;
    worker.once("error", (error) => void this.close(error));
    worker.once("exit", (code) => {
      void this.close(new Error(`Development worker exited with code ${String(code)}.`));
    });
    worker.on("message", (message: unknown) => this._handleMessage(message));
  }
}

export const createNodeDevelopmentRunner: DevelopmentRunnerFactory = (input) =>
  new NodeDevelopmentRunner(input);
