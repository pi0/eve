import type * as RunModule from "#compiled/run/index.js";

const WORKFLOW_SANDBOX_MODULE_KEY = Symbol.for("eve.workflowSandbox.module");

type WorkflowSandboxModule = Pick<
  typeof RunModule,
  "createRunner" | "createSignedContinuationCodec" | "getHostFunctionContext" | "RunError"
>;

type WorkflowSandboxGlobal = typeof globalThis & {
  [WORKFLOW_SANDBOX_MODULE_KEY]?: WorkflowSandboxModule;
};

let workflowSandboxModulePromise: Promise<WorkflowSandboxModule> | undefined;

export function installWorkflowSandboxModule(module: WorkflowSandboxModule): void {
  (globalThis as WorkflowSandboxGlobal)[WORKFLOW_SANDBOX_MODULE_KEY] = module;
}

/**
 * Returns the vendored `run` runtime that executes generated workflow programs.
 *
 * `specifier` is a parameter because a minifier cannot fold an exported
 * function's parameter into a literal. A literal `import()` would make hosted
 * bundles include `run` for every agent, not only agents with a workflow tool.
 */
export async function loadWorkflowSandboxModule(
  specifier = "#compiled/run/index.js",
): Promise<WorkflowSandboxModule> {
  const installed = (globalThis as WorkflowSandboxGlobal)[WORKFLOW_SANDBOX_MODULE_KEY];
  if (installed !== undefined) return installed;

  workflowSandboxModulePromise ??= import(specifier) as Promise<typeof RunModule>;
  return await workflowSandboxModulePromise;
}
