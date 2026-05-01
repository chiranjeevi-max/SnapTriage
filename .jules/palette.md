## 2024-05-01 - Tooltips for icon-only buttons
**Learning:** Icon-only buttons lacking `aria-label` or tooltips create accessibility barriers and bad UX. Using the `Tooltip` component from `shadcn/ui` combined with an `aria-label` is a scalable pattern for improving the accessibility of small icon actions.
**Action:** Always check icon-only buttons for an accessible name (`aria-label`) and verify if a tooltip would help sighted users understand the button's action without guessing.
