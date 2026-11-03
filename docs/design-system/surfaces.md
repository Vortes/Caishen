# Surfaces

## Card

`src/components/ui/card.tsx`. Use to group related details into one
section, like each block of the inspector. It takes only `children`: no
variants, no padding or tint options.

Stack cards with `--space-stack` between them. Never nest a card in a card;
use a divider (`--border-subtle`) inside one card instead.

```tsx
// Correct
<Card>
  <Property label="Posted">{money(balance - pending)}</Property>
  <Property label="Pending">{money(pending)}</Property>
</Card>

// Incorrect: a hand-built card, and a card tinted to signal a state
<section className={styles.card} style={{ background: "var(--green-800-a)" }}>
  …
</section>
```

A card says what state something is in through its contents (a funding
figure, a `Tag`), never through its own background or border.

## Tooltip

`src/components/ui/tooltip.tsx`. Use for a short name or shortcut on hover
and focus. Never put information only in a tooltip; touch devices can't
hover, so anything the user needs must be visible on the page.

`label` is one short phrase with no ending period. `shortcut` is shown as
written ("⌘K", "]"). The tooltip wraps exactly one focusable element.

```tsx
// Correct
<Tooltip label="Go to this month">
  <button type="button" className={styles.monthButton} onClick={toToday}>
    {month.label}
  </button>
</Tooltip>

// Incorrect: an IconButton already shows its label as a tooltip
<Tooltip label="Filter">
  <IconButton label="Filter">
    <ListFilterIcon aria-hidden />
  </IconButton>
</Tooltip>
```

## SurfaceProvider

`src/components/ui/surface.tsx`. Every popover, menu, dialog and tooltip
renders through a portal into the provider's `container`, so a panel that
clips its overflow can't cut them off, and the root's `data-theme` still
applies. The provider also tracks the input method that decides motion.
Wrap a screen's themed root in it once; the app shell, entry pages and the
empty frame already do.

```tsx
<SurfaceProvider container={rootElement}>{screen}</SurfaceProvider>
```

[`Popover`](popovers.md), [`Menu`](menus.md) and [`Dialog`](dialogs.md) own
everything else that makes a surface: the 6px gap
from the trigger, 12px clearance from the window edge, the z-layer, the
raised surface tokens, the available-height clamp and the motion. A screen
passes names and content, never positioning props, classes or Radix parts.
Something the interface can't express means widening the module in
`src/components/ui`, never reaching past it.

## Motion

**Default to instant.** Animation is reserved for occasional secondary
actions where the entrance connects the surface to its trigger. Pass
`motion="occasional"` to a `Popover` or `Menu` only when its surface is in
the occasional row:

| Frequency                    | Surfaces                                                                                                                                                                                                                                                         | `motion`             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Frequent work                | Ready to Assign, move money / cover overspending, create category/group, target behavior, reconcile, transaction entry and sharing, bulk categorizing/sharing, record repayments, request/pay partner, month picker, Reflect filters and chart details | `frequent` (default) |
| Occasional secondary actions | Profile, Banks, bank options, bank status, Add account                                                                                                                                                                                                           | `occasional`         |

A new surface is frequent unless its frequency justifies opting in. Inside
frequent forms, steps such as destination lists and sharing or
reconciliation change immediately, without height animation or
cross-fades. Dialogs are always occasional; submenus always instant.

What the module does with it, so nothing needs adding at a site:

- An occasional surface animates only when the pointer opens it. A keyboard
  opening is instant and focuses at once. The input method is captured as
  it opens, so typing inside a form can't change its entrance or exit.
- Popovers and menus enter over `--duration-popover-enter` with
  `--ease-panel` from `--scale-popover`, `--distance-popover` toward the
  trigger, following the resolved side; they exit over
  `--duration-popover-exit` with `ease-in`. Dialogs grow from the center
  with their scrim over `--duration-dialog-enter` and leave over
  `--duration-dialog-exit`. The values are in [scale.md](scale.md#motion).
- `prefers-reduced-motion: reduce` disables all of it.
- `Button` and `IconButton` don't scale on press while they carry
  `aria-haspopup`, so the surface can't measure a pressed trigger and jump.
  A hand-built trigger keeps still on press too.
