# Caishen design system

A calm, near-neutral shell where color means something. Surfaces are grays
generated from one hue. Color communicates money states (funded,
underfunded, overspent), semantic feedback, the committing action, or
interaction state (checked controls, row selection, keyboard focus).
Do not use color as decoration.

Read this file before building any UI. Read the topic file for each component
you use.

## Rules

1. **Build from `src/components/ui/` only.**
2. **Use only semantic tokens from `src/styles/tokens.css`.** Never a
   primitive (`--violet-500`), never a raw value (`#…`, `oklch(…)`, `white`).
   A raw value can't follow the light theme, and a primitive says what a color
   looks like, not what it's for.
3. **Variants are closed sets.** Every prop union below is the complete list.
   A variant that isn't listed (`ghost`, `outline`, `destructive`, `link`)
   is a bug, not an option, and fails the type check.
4. **No `className` or `style` on primitives.** They don't accept them. If a
   primitive can't express what the design needs, stop and raise it; don't
   wrap it in a styled element to override its color, size, or spacing.
   Wrapping for layout (placement in a grid, `margin-top`) is fine.
5. **Money states and feedback never share names.** A category's funding
   state uses `--status-*` tokens and the funding components. Anything that
   asks the user to act uses `--feedback-attention` and `Tag tone="attention"`.
   They can look alike (both amber); they mean different things.
6. **Dark is the default theme.** Any element switches its subtree with
   `data-theme="light"`. Check every screen in both.
7. **Row selection uses the grouped outline in [rows.md](rows.md).** Apply
   it to every selectable table or list, not just transactions. Selection
   is distinct from hover, keyboard focus, and the current detail row.

## Topics

| File                       | Covers                                                      |
| -------------------------- | ----------------------------------------------------------- |
| [tokens.md](tokens.md)     | Colors, surfaces, text, borders, money states, feedback     |
| [scale.md](scale.md)       | Type sizes, control and row heights, spacing, radii, motion |
| [buttons.md](buttons.md)   | `Button`, `IconButton`                                      |
| [choices.md](choices.md)   | `Switch`, `Checkbox`, `SegmentedControl`, `Tabs`            |
| [rows.md](rows.md)         | Shared row-selection outline, grouping, states, motion      |
| [labels.md](labels.md)     | `Tag`, the review dot                                       |
| [surfaces.md](surfaces.md) | `Card`, `Tooltip`, popover spacing and motion, portals      |
| [toasts.md](toasts.md)     | `Toast`, `ToastRegion`                                      |
| [loading.md](loading.md)   | `Skeleton`, and which loading state to use                  |

## Not in the system yet

These patterns exist in the app shell
(`src/components/app-shell/`) but have no primitive. Copy the
shell's pattern, use only semantic tokens, and say in your summary that
the screen needs the missing primitive. Never invent a new primitive inline.

- **Rows**: plan, register, list, and menu rows (`.row`, `.listRow`,
  `.preset`, `.actionItem` in the shell). No shared row primitive exists;
  selection styling must follow [rows.md](rows.md).
- **Navigation**: sidebar items and section headings, breadcrumbs, the
  Spending Breakdown / Trends report tabs.
- **Form fields**: text inputs, selects, amount fields.
- **Popover and dialog surfaces**: the shell styles its own popover.
  Every popover follows the shared gap and motion rules in [surfaces.md](surfaces.md).
  For a dialog, use `Dialog` or `ConfirmDialog` from
  `src/components/ui/dialog.tsx`; never Radix directly.
- **Base styles**: the focus ring (`--focus-ring`, 2px) and the button font
  reset live in the shell's root class, not globally. A screen outside the
  app shell has to repeat them.
- **Funding components**: `AvailablePill`, `FundingBar`, `FundingRing`, and
  `Meter` live in the shell and take the category's `Funding` state from
  `model.ts`. Use them for money states; never rebuild one with a `Tag`.
  Get the state from `categoryStatus()` in
  `src/components/budget/category-row-status.ts`; never pick one by hand.
  A hand-picked state drifts from the plan's: a $0.00 category with a
  target is `underfunded` (amber), not `empty`.
