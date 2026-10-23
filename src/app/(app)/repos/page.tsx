/**
 * @module app/(app)/repos/page
 * Repository management page. Displays a heading and description, then renders
 * the {@link RepoManager} component where users can connect, disconnect, and
 * configure GitHub and GitLab repositories for issue syncing.
 */
import { PageHeader } from "@/components/page-header";
import { RepoManager } from "@/features/repos/components/repo-manager";

export default function ReposPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <PageHeader
        title="Repositories"
        description="Connect the GitHub and GitLab repositories you want to triage."
      />
      <div className="mt-8">
        <RepoManager />
      </div>
    </div>
  );
}
