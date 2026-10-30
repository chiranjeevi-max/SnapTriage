/**
 * @module keyboard/components/shortcut-list
 *
 * Renders the shortcut registry.
 *
 * The app and the landing page show the same bindings, so both read them from
 * {@link shortcuts} instead of keeping their own list.
 */
import { Kbd } from "@/features/keyboard/components/kbd";
import {
  categoryLabels,
  categoryOrder,
  formatKey,
  shortcuts,
  type Shortcut,
} from "@/features/keyboard/shortcut-registry";

interface ShortcutGroupsProps {
  /** Extra classes for the grid. */
  className?: string;
}

/**
 * Shortcuts grouped by category, one column per category.
 *
 * @param props - {@link ShortcutGroupsProps}
 */
export function ShortcutGroups({ className }: ShortcutGroupsProps) {
  return (
    <div className={className ?? "grid gap-10 sm:grid-cols-3"}>
      {categoryOrder.map((category) => (
        <div key={category}>
          <h3 className="text-sm font-medium">{categoryLabels[category]}</h3>
          <ul className="mt-4 space-y-3">
            {shortcuts
              .filter((shortcut) => shortcut.category === category)
              .map((shortcut) => (
                <ShortcutRow key={shortcut.id} shortcut={shortcut} />
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface ShortcutListProps {
  /** Shortcut categories to include. Defaults to all of them. */
  categories?: Shortcut["category"][];
  /** Extra classes for the grid. */
  className?: string;
}

/**
 * Every shortcut as a flat grid of key and description pairs.
 *
 * @param props - {@link ShortcutListProps}
 */
export function ShortcutList({ categories, className }: ShortcutListProps) {
  const visible = categories
    ? shortcuts.filter((shortcut) => categories.includes(shortcut.category))
    : shortcuts;

  return (
    <dl
      className={
        className ?? "grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-x-6 gap-y-3"
      }
    >
      {visible.map((shortcut) => (
        <div key={shortcut.id} className="flex min-w-0 items-start justify-between gap-3">
          <dt className="min-w-0 break-words text-sm leading-relaxed text-muted-foreground">
            {shortcut.description}
          </dt>
          <dd className="shrink-0 pt-0.5">
            <Kbd>{formatKey(shortcut)}</Kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One shortcut: its description on the left, the key on the right. */
function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <li className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{shortcut.description}</span>
      <Kbd>{formatKey(shortcut)}</Kbd>
    </li>
  );
}
