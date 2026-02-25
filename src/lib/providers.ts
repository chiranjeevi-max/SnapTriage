/**
 * @module providers
 *
 * Provider registry that maps a provider name ("github" | "gitlab") to its
 * {@link IssueProvider} implementation. All platform-specific API access
 * flows through {@link getProvider}.
 */
import type { IssueProvider } from "./provider-interface";
import { githubProvider } from "./github";
import { gitlabProvider } from "./gitlab";

/** Map of supported provider names to their implementations. */
const providers: Record<string, IssueProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
};

/**
 * Returns the {@link IssueProvider} for the given provider name.
 * @param name - Provider identifier, e.g. "github" or "gitlab".
 * @returns The matching provider implementation.
 * @throws If the provider name is not registered.
 */
export function getProvider(name: string): IssueProvider {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}
