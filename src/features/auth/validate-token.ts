export type TokenProvider = "github" | "gitlab";

interface ValidatedUser {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

export async function validateGitHubToken(token: string): Promise<ValidatedUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  if (!res.ok) {
    throw new Error("Invalid GitHub token");
  }

  const data = await res.json();
  return {
    id: String(data.id),
    name: data.name || data.login,
    email: data.email,
    image: data.avatar_url,
  };
}

export async function validateGitLabToken(token: string): Promise<ValidatedUser> {
  const baseUrl = process.env.AUTH_GITLAB_URL || "https://gitlab.com";
  const res = await fetch(`${baseUrl}/api/v4/user`, {
    headers: { "PRIVATE-TOKEN": token },
  });

  if (!res.ok) {
    throw new Error("Invalid GitLab token");
  }

  const data = await res.json();
  return {
    id: String(data.id),
    name: data.name || data.username,
    email: data.email,
    image: data.avatar_url,
  };
}

export async function validateToken(
  token: string,
  provider: TokenProvider
): Promise<ValidatedUser> {
  if (provider === "github") return validateGitHubToken(token);
  if (provider === "gitlab") return validateGitLabToken(token);
  throw new Error(`Unknown provider: ${provider}`);
}
