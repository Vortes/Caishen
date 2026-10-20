# Caishen design system

A calm, near-neutral shell where color means something. Surfaces are grays
generated from one hue, and color appears in exactly two places: money states
(funded, underfunded, overspent) and the one action that commits something.
If a screen has color anywhere else, something is wrong.

Read this file before building any UI. Read the topic file for each component
you use.

## Rules

1. **Build from `src/components/ui/` only.** Never import from
   `src/components/ui-legacy/`; those are the old shadcn components, kept only
   until the legacy screens migrate.
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

## Topics

| File                       | Covers                                                      |
| -------------------------- | ----------------------------------------------------------- |
| [tokens.md](tokens.md)     | Colors, surfaces, text, borders, money states, feedback     |
| [scale.md](scale.md)       | Type sizes, control and row heights, spacing, radii, motion |
| [buttons.md](buttons.md)   | `Button`, `IconButton`                                      |
| [choices.md](choices.md)   | `Switch`, `Checkbox`, `SegmentedControl`, `Tabs`            |
| [labels.md](labels.md)     | `Tag`, `Badge`                                              |
| [surfaces.md](surfaces.md) | `Card`, `Tooltip`, portals                                  |
| [toasts.md](toasts.md)     | `Toast`, `ToastRegion`                                      |
| [loading.md](loading.md)   | `Skeleton`, and which loading state to use                  |

## Not in the system yet

These patterns exist in the app shell prototype
(`src/components/prototype/app-shell/`) but have no primitive. Copy the
prototype's pattern, use only semantic tokens, and say in your summary that
the screen needs the missing primitive. Never invent a new primitive inline.

- **Rows**: plan, register, list, and menu rows (`.row`, `.listRow`,
  `.preset`, `.actionItem` in the prototype).
- **Navigation**: sidebar items and section headings, breadcrumbs, the
  Spending Breakdown / Trends report tabs.
- **Form fields**: text inputs, selects, amount fields.
- **Popover and dialog surfaces**: the prototype styles its own popover.
  For a confirm dialog, use Radix `AlertDialog` with that surface, Cancel
  as `secondary`, and the confirm as `danger` or `primary`.
- **Base styles**: the focus ring (`--focus-ring`, 2px) and the button font
  reset live in the shell's root class, not globally. A screen outside the
  app shell has to repeat them.
- **Funding components**: `AvailablePill`, `FundingBar`, `FundingRing`, and
  `Meter` live in the prototype and take the category's `Funding` state from
  `model.ts`. Use them for money states; never rebuild one with a `Tag`.
