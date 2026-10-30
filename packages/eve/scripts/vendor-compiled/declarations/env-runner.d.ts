import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

export interface WorkerHooks {
  onClose?(runner: BaseEnvRunner, cause?: unknown): void;
  onReady?(runner: BaseEnvRunner): void;
}

export interface BaseEnvRunnerOptions {
  readonly data?: Record<string, unknown>;
  readonly hooks?: WorkerHooks;
  readonly name: string;
  readonly workerEntry: string;
}

export abstract class BaseEnvRunner {
  closed: boolean;
  get ready(): boolean;
  protected _closeCause: unknown;
  protected _data: Record<string, unknown> | undefined;
  protected _name: string;
  protected _workerEntry: string;

  constructor(options: BaseEnvRunnerOptions);

  close(cause?: unknown): Promise<void>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  abstract sendMessage(message: unknown): void;
  shutdown(timeout?: number): Promise<void>;
  upgrade(context: {
    node: { head: Uint8Array; req: IncomingMessage; socket: Socket };
  }): Promise<void>;
  waitForReady(timeout?: number): Promise<void>;

  protected abstract _closeRuntime(): Promise<void>;
  protected _handleMessage(message: unknown): void;
  protected abstract _hasRuntime(): boolean;
  protected _initWithVirtualData(initialize: () => void): void;
  protected abstract _runtimeType(): string;
}
