/**
 * @module components/page-header
 *
 * Title, description, and actions for a page inside the app.
 *
 * Every app page opens with one of these so the hierarchy reads the same
 * from the inbox to the settings.
 */
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Page title. */
  title: string;
  /** One line explaining what the page is for. */
  description?: string;
  /** Actions shown on the right, e.g. a primary button. */
  actions?: React.ReactNode;
  /** Extra classes for the header row. */
  className?: string;
}

/**
 * Page heading with an optional description and action slot.
 *
 * @param props - {@link PageHeaderProps}
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b pb-8 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold tracking-[-0.035em]">{title}</h1>
        {description && (
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
