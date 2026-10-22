import type { SandboxNetworkPolicy } from "#shared/sandbox-network-policy.js";
import type { SandboxSession } from "#shared/sandbox-session.js";
type NetworkPolicySandboxSession = SandboxSession & {
  setNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void>;
};
import { enrichMicrosandboxError } from "#execution/sandbox/bindings/microsandbox-create.js";
import {
  createMicrosandboxHandle,
  deleteMicrosandboxSession,
  microsandboxSessionIdentity,
  type MicrosandboxPreparedArtifact,
  prewarmMicrosandboxTemplate,
} from "#execution/sandbox/bindings/microsandbox-lifecycle.js";
import {
  microsandboxOptionsForHash,
  resolveMicrosandboxOptions,
} from "#execution/sandbox/bindings/microsandbox-options.js";
import { createStableHash } from "#execution/sandbox/bindings/microsandbox-runtime.js";
import { materializeSandboxDockerfile } from "#execution/sandbox/dockerfile.js";
import { createSandboxProviderIdentity } from "#execution/sandbox/provider-identity.js";
import type {
  MicrosandboxSandboxCreateOptions,
  MicrosandboxSandboxRuntimeOptions,
} from "#public/sandbox/microsandbox-sandbox.js";
import {
  isSandboxPreparedArtifactRecord,
  sandboxProviderResourceIdentity,
  type SandboxPreparedArtifact,
  type SandboxProviderImplementation,
} from "#shared/sandbox-provider.js";

export { pruneMicrosandboxTemplates } from "#execution/sandbox/bindings/microsandbox-templates.js";

export const MICROSANDBOX_PROVIDER_NAME = "microsandbox";

export type MicrosandboxProviderSessionState = {
  readonly sessionIdentity: string;
  readonly version: 3;
};

export function createMicrosandboxSandboxProvider(
  authoredOptions: MicrosandboxSandboxCreateOptions | undefined = undefined,
): SandboxProviderImplementation<
  MicrosandboxSandboxRuntimeOptions,
  MicrosandboxPreparedArtifact,
  MicrosandboxProviderSessionState,
  NetworkPolicySandboxSession
> {
  const createOptions = authoredOptions ?? {};
  const options = resolveMicrosandboxOptions(createOptions);
  const optionsHash = createStableHash(JSON.stringify(microsandboxOptionsForHash(options))).slice(
    0,
    20,
  );

  return {
    async onSessionEnd(context, state) {
      await deleteMicrosandboxSession({
        context,
        sessionIdentity: state?.sessionIdentity ?? microsandboxSessionIdentity(context),
      });
    },
    async prepare(context) {
      const dockerfile = await materializeSandboxDockerfile({
        files: context.files,
        storagePath: context.storagePath,
      });
      const templateKey = createSandboxProviderIdentity({
        dockerfile: dockerfile?.contentHash,
        optionsHash,
        resources: sandboxProviderResourceIdentity(context.resources),
        sourceRevision: context.sourceRevision,
        version: 2,
      }).slice(0, 24);
      try {
        return await prewarmMicrosandboxTemplate({
          context,
          dockerfile,
          options,
          optionsHash,
          prepare: createOptions.prepare,
          providerName: MICROSANDBOX_PROVIDER_NAME,
          templateKey,
        });
      } catch (error) {
        throw enrichMicrosandboxError({ context: "Failed to prepare microsandbox", error });
      }
    },
    async resume(context, artifactValue, stateValue) {
      const artifact = requireArtifact(artifactValue);
      const state = requireState(stateValue);
      const result = await createMicrosandboxHandle({
        artifact,
        context,
        createIfMissing: false,
        sessionIdentity: state.sessionIdentity,
        options,
        optionsHash,
        providerName: MICROSANDBOX_PROVIDER_NAME,
      });
      return result.handle;
    },
    async start(context, runtimeOptions, artifactValue) {
      const artifact = requireArtifact(artifactValue);
      return await createMicrosandboxHandle({
        artifact,
        context,
        createIfMissing: true,
        options,
        optionsHash,
        providerName: MICROSANDBOX_PROVIDER_NAME,
        runtimeOptions,
        sessionIdentity: microsandboxSessionIdentity(context),
      });
    },
  };
}

function requireArtifact(artifact: SandboxPreparedArtifact): MicrosandboxPreparedArtifact {
  if (
    !isSandboxPreparedArtifactRecord(artifact) ||
    artifact.version !== 2 ||
    typeof artifact.optionsHash !== "string" ||
    typeof artifact.snapshotName !== "string"
  ) {
    throw new Error("Invalid prepared microsandbox artifact.");
  }
  return {
    image: typeof artifact.image === "string" ? artifact.image : null,
    optionsHash: artifact.optionsHash,
    snapshotName: artifact.snapshotName,
    version: 2,
  };
}

function requireState(state: unknown): MicrosandboxProviderSessionState {
  if (
    !isSandboxPreparedArtifactRecord(state) ||
    state.version !== 3 ||
    typeof state.sessionIdentity !== "string"
  ) {
    throw new Error("Invalid microsandbox session state.");
  }
  return { sessionIdentity: state.sessionIdentity, version: 3 };
}
