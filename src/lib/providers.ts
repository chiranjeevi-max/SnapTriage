import type { IssueProvider } from "./provider-interface";
import { githubProvider } from "./github";
import { gitlabProvider } from "./gitlab";

const providers: Record<string, IssueProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider,
};

export function getProvider(name: string): IssueProvider {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}
