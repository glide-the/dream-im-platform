// [Input] Explicit deployment configs or named environment config plus injected fetch/clock dependencies.
// [Output] Process-stable registry of fail-closed Codex, xAI, and GitHub Copilot product adapters.
// [Pos] Provider product composition root shared by Admin orchestration and Gateway resource routing.
// [Sync] 2026-09-04: add explicit and environment-backed registry construction.

import { CodexProviderAdapter } from "./codex";
import {
  providerProductConfigsFromEnv,
  type ProviderProductConfigs,
} from "./config";
import { GitHubCopilotProviderAdapter } from "./github-copilot";
import type {
  ProviderClock,
  ProviderFetch,
  ProviderProductAdapter,
  ProviderProductKind,
  ProviderProductRegistry,
  ProviderReadiness,
} from "./types";
import { XaiProviderAdapter } from "./xai";

export type CreateProviderProductRegistryInput = Readonly<{
  configs: ProviderProductConfigs;
  fetch?: ProviderFetch;
  now?: ProviderClock;
}>;

export function createProviderProductRegistry(
  input: CreateProviderProductRegistryInput,
): ProviderProductRegistry {
  const dependencies = {
    fetch: input.fetch ?? globalThis.fetch,
    now: input.now ?? Date.now,
  };
  const adapters: Record<ProviderProductKind, ProviderProductAdapter> = {
    codex: new CodexProviderAdapter(input.configs.codex, dependencies),
    xai: new XaiProviderAdapter(input.configs.xai, dependencies),
    github_copilot: new GitHubCopilotProviderAdapter(
      input.configs.github_copilot,
      dependencies,
    ),
  };
  return {
    readiness(product): ProviderReadiness {
      return adapters[product].readiness();
    },
    get(product): ProviderProductAdapter {
      return adapters[product];
    },
    allReadiness(): readonly ProviderReadiness[] {
      return (["codex", "xai", "github_copilot"] as const).map(
        (product) => adapters[product].readiness(),
      );
    },
  };
}

export function createProviderProductRegistryFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: Readonly<{ fetch?: ProviderFetch; now?: ProviderClock }> = {},
): ProviderProductRegistry {
  return createProviderProductRegistry({
    configs: providerProductConfigsFromEnv(environment),
    ...dependencies,
  });
}

let processRegistry: ProviderProductRegistry | undefined;

export function getProviderProductRegistry(): ProviderProductRegistry {
  processRegistry ??= createProviderProductRegistryFromEnv();
  return processRegistry;
}
