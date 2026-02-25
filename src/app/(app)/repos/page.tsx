import { RepoManager } from "@/features/repos/components/repo-manager";

export default function ReposPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Repositories</h1>
        <p className="text-muted-foreground">
          Connect GitHub and GitLab repos to start triaging issues.
        </p>
      </div>
      <RepoManager />
    </div>
  );
}
