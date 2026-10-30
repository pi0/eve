import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

export interface WorkerHooks {
  onClose?(runner: NodeWorkerEnvRunner, cause?: unknown): void;
  onReady?(runner: NodeWorkerEnvRunner): void;
}

export interface NodeWorkerEnvRunnerOptions {
  readonly data?: Record<string, unknown>;
  readonly hooks?: WorkerHooks;
  readonly name: string;
  readonly workerEntry?: string;
}

export class NodeWorkerEnvRunner {
  closed: boolean;
  get ready(): boolean;
  protected _closeCause: unknown;

  constructor(options: NodeWorkerEnvRunnerOptions);

  close(cause?: unknown): Promise<void>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  sendMessage(message: unknown): void;
  shutdown(timeout?: number): Promise<void>;
  upgrade(context: {
    node: { head: Uint8Array; req: IncomingMessage; socket: Socket };
  }): Promise<void>;
  waitForReady(timeout?: number): Promise<void>;
}
