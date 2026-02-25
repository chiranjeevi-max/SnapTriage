/**
 * @module app/(app)/inbox/page
 * Inbox page for SnapTriage. Renders the {@link InboxView} component which
 * displays the keyboard-navigable list of issues fetched from connected
 * GitHub and GitLab repositories.
 */
import { InboxView } from "@/features/inbox/components/inbox-view";

export default function InboxPage() {
  return <InboxView />;
}
