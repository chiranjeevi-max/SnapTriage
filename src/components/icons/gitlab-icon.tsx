/**
 * @module components/icons/gitlab-icon
 * Shared GitLab logo SVG component. Lucide-react doesn't include a GitLab icon,
 * so this inline SVG is used across login, sidebar, and repo manager UIs.
 */

interface GitLabIconProps {
  className?: string;
}

/** Inline GitLab logo SVG icon matching the lucide-react icon API. */
export function GitLabIcon({ className }: GitLabIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}
