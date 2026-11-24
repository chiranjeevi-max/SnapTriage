"use client";

import { Kbd } from "./kbd";
import { useShortcutLabel } from "../use-shortcut-label";

/** A `Kbd` whose label follows the current shortcut override. */
export function ShortcutKbd({
  id,
  ...props
}: { id: string } & Omit<React.ComponentProps<typeof Kbd>, "children">) {
  const label = useShortcutLabel(id);
  return <Kbd {...props}>{label}</Kbd>;
}
