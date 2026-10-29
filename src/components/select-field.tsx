/**
 * @module components/select-field
 *
 * A styled native `<select>`.
 *
 * The project has no select primitive, so this keeps every dropdown in the
 * app on the same look: a quiet control that matches the toolbar height and
 * carries its own chevron.
 */
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Native select with the app's control styling.
 *
 * @param props - Standard `<select>` props.
 */
export function SelectField({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative inline-flex min-w-0 max-w-full items-center">
      <select
        className={cn(
          "h-9 min-w-0 max-w-full appearance-none rounded-md border border-input bg-card pl-3 pr-7 text-xs text-foreground transition-colors",
          "hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}
