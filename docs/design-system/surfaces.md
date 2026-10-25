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

## Popovers and dropdown menus

Use a popover for a small form or contextual detail attached to a trigger;
use a dropdown menu for a list of actions. These are shell patterns, not
shared primitives. Follow `account-entry.tsx` and `banks.tsx` in
`src/components/app-shell/`, or `ProfileMenu` in `sidebar.tsx` for a menu.

Every popover, dropdown menu, and tooltip uses `POPOVER_GAP` (6px) from
`src/components/ui/tokens.ts` for the space between its button and surface:

```tsx
import { POPOVER_GAP } from "~/components/ui/tokens";

// Correct: the shared trigger gap, independent of viewport collision padding.
<Popover.Content side="top" align="start" sideOffset={POPOVER_GAP} collisionPadding={12}>
  …
</Popover.Content>

// Incorrect: omitting sideOffset makes the surface touch its button.
<Popover.Content side="top" align="start">…</Popover.Content>
```

Do not simulate the gap with margin, padding, or a positioning transform.
Radix must include it when calculating placement and available height.
Use collision padding for viewport clearance; it must not shift a
left-aligned surface away from a trigger near the left edge.

## Popover and dropdown menu motion

Use `src/components/ui/popover-motion.module.css` and `usePopoverMotion`
from `src/components/ui/popover-motion.tsx` for popovers and dropdown menus.
The shared stylesheet owns the keyframes and reads the four popover motion
tokens in [scale.md](scale.md#motion); do not duplicate them in feature CSS.

```css
/* In an app-shell surface module; adjust the relative path as needed. */
.popover {
  composes: content from "../ui/popover-motion.module.css";
}
```

```tsx
const [open, setOpen] = useState(false);
const motion = usePopoverMotion(open);

<Popover.Root open={open} onOpenChange={setOpen}>
  {/* Trigger and themed portal */}
  <Popover.Content
    {...motion}
    className={styles.popover}
    sideOffset={POPOVER_GAP}
  >
    …
  </Popover.Content>
</Popover.Root>;
```

`TooltipProvider` installs the motion provider once for the shell. The hook
captures the input method when opening, so typing inside a form cannot
change its entrance or exit. Keep content and its anchor mounted while
Radix completes the exit animation.

The existing transaction option lists (`transaction-fields.tsx`), date
calendar (`transaction-date.tsx`), and bulk Categorize form
(`transaction-review.tsx`) remain unanimated pending separate review.
Do not add motion to these three surfaces as part of other styling changes.

- Enter over **180ms** with **`var(--ease-panel)`**, fading from opacity 0
  and scaling from **0.97** to 1. Start **4px toward the trigger**: translate
  down for a surface above its trigger, up for one below it. Finish with no
  transform. Follow the resolved placement if collision handling flips it.
- Exit over **120ms** with **`ease-in`**, fading to opacity 0 and scaling
  to **0.97**. Use `forwards` so it stays faded until Radix unmounts it.
- The shared stylesheet sets `transform-origin` to
  `var(--radix-popper-transform-origin)`, inherited from Radix's wrapper
  for both popovers and dropdown menus.
  Animate the content, never Radix's positioning wrapper.
- Pointer opening animates. Keyboard opening is instant: spread the hook's
  `data-instant` attribute onto the content. Preserve the normal
  keyboard focus behavior; do not wait for an animation to focus a field.
- Under **`prefers-reduced-motion: reduce`**, disable both enter and exit
  animation. Tooltip motion remains the shared `Tooltip` component's own
  behavior; it shares the gap token, not this menu animation.
- Never scale or translate a popup trigger during press, including while
  it is still closed. Radix can measure the pressed button before it
  settles, then snap the surface sideways as its anchor changes. The
  shared `IconButton` excludes `[aria-haspopup]` from press scaling.

## Portals

Tooltips and popovers render through a portal so a panel that clips its
overflow can't cut them off. The portal targets the themed root instead of
`<body>`, so the subtree's `data-theme` still applies.

Wrap a screen once in `TooltipProvider`, passing its root element as
`container`. A Radix popover gets the same element from
`usePortalContainer()`:

```tsx
const container = usePortalContainer();
<Popover.Portal container={container}>…</Popover.Portal>;
```

A portal into `<body>` renders in dark mode on a light screen.
