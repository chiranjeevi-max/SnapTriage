/**
 * @module keyboard/is-editable-element
 *
 * Shared check for elements that swallow keystrokes.
 */

/**
 * Checks whether the event target is an editable form element.
 * Prevents shortcuts from firing while the user is typing.
 *
 * @param el - The event target to inspect.
 * @returns `true` when the target accepts text input.
 */
export function isEditableElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}
