import { NodeWorkerEnvRunner } from "#compiled/env-runner/index.js";
import { resolvePackageCompiledFilePath } from "#internal/application/package.js";

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

class NodeDevelopmentRunner extends NodeWorkerEnvRunner implements DevelopmentRunner {
  readonly #closedListeners: Set<(cause?: unknown) => void>;

  constructor(input: DevelopmentRunnerInput) {
    // Created before `super()`: a missing worker entry closes the runner
    // inside the base constructor, before class fields exist.
    const closedListeners = new Set<(cause?: unknown) => void>();
    super({
      data: {
        entry: input.entry,
        ...input.workerData,
      },
      hooks: {
        onClose: (_runner, cause) => {
          const listeners = [...closedListeners];
          closedListeners.clear();
          for (const listener of listeners) {
            listener(cause);
          }
        },
      },
      name: input.name,
      workerEntry: resolvePackageCompiledFilePath("src/compiled/env-runner/node-worker.js"),
    });
    this.#closedListeners = closedListeners;
  }

  onceClosed(listener: (cause?: unknown) => void): void {
    if (this.closed) {
      listener(this._closeCause);
      return;
    }
    this.#closedListeners.add(listener);
  }

  override async shutdown(): Promise<void> {
    await super.shutdown(DEVELOPMENT_WORKER_SHUTDOWN_TIMEOUT_MS);
  }
}

export const createNodeDevelopmentRunner: DevelopmentRunnerFactory = (input) =>
  new NodeDevelopmentRunner(input);
