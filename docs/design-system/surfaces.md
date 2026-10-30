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

The modules below own everything else that makes a surface: the 6px gap
from the trigger, 12px clearance from the window edge, the z-layer, the
raised surface tokens, the available-height clamp and the motion. A screen
passes names and content, never positioning props, classes or Radix parts.
Something the interface can't express means widening the module in
`src/components/ui`, never reaching past it.

## Popover

`src/components/ui/popover.tsx`. Use for a small form or contextual detail
that hangs from something. The surface adds no padding; the content lays
itself out. Height is clamped to the room on the placed side, and the
content scrolls past it.

```tsx
<Popover
  label="Choose a month"
  trigger={
    <button type="button" aria-label={`${month.label}, choose a month`}>
      …
    </button>
  }
  open={open}
  onOpenChange={setOpen}
  // The picker focuses the month on screen itself.
  autoFocus={false}
>
  <MonthGrid month={month} onPick={pick} />
</Popover>
```

| Prop               | Values                        | Use                                                                                      |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `label`            | string, required              | The accessible name of the popover                                                       |
| `trigger`          | element                       | The button that opens and closes it                                                      |
| `anchor`           | element                       | What it hangs from: an input, a chart slice, or a frame around the trigger               |
| `open`             | boolean                       | Controlled state; required with `anchor` alone                                           |
| `onOpenChange`     | `(open) => void`              | Required with `anchor` alone                                                             |
| `side`             | `top` `right` `bottom` `left` | Default `bottom`                                                                         |
| `align`            | `start` `center` `end`        | Default `start`                                                                          |
| `size`             | `form` `wide` `trigger`       | Width; without it, the content sets the width                                            |
| `motion`           | `frequent` `occasional`       | Default `frequent` (instant); see [Motion](#motion)                                      |
| `autoFocus`        | boolean                       | Default on with a trigger; off when the content places focus itself                      |
| `onCloseAutoFocus` | `(event) => void`             | `preventDefault()` keeps focus from returning, for a site that focuses what it just made |
| `arrow`            | boolean                       | A small arrow at the trigger, for a form that acts on the one thing it hangs from        |
| `id`               | string                        | For a field that names the popover in `aria-controls`                                    |

Sizes:

- `form` is `--size-popover` (320px): a small form.
- `wide` is `--size-popover-wide` (560px): a table of transactions.
- `trigger` is the trigger's or anchor's width, never narrower than 20rem:
  a list under a field. A longer row truncates rather than widening it.

Three ways to hang it:

- **Trigger.** The common case. It takes focus on open, closes on Escape
  and returns focus to the trigger.
- **Trigger and a separate anchor.** The trigger still toggles it, but it
  hangs from the anchor, such as the border of the bar the trigger sits in.
- **Anchor alone.** The site controls `open`. Focus stays in the anchor (an
  input keeps typing), the site handles Escape, and a click outside both
  closes it. Add `autoFocus` for a form or panel opened by something other
  than a button, like a field's New row or a chart slice: it then takes
  focus and closes on Escape as a trigger popover does.

The surface clears the window edge by 12px on every side but the edge it
aligns to: a trigger near the edge, like Banks in the sidebar, keeps its
surface flush with that edge rather than pushed off it. `align="center"`
clears all four.

Popovers stack by mount order: one opened from inside another sits above
it. Every dialog sits above every popover.

## Menu

`src/components/ui/menu.tsx`. Use for a list of actions; use a `Popover`
for a form. A menu is always non-modal: the page behind stays live, and a
click outside closes the menu and lands. It is as wide as its trigger and
never narrower than 248px; hung from an `anchor`, it keeps 248px.

```tsx
<Menu
  label={budgetName}
  motion="occasional"
  trigger={<button type="button">…</button>}
>
  <MenuItem
    icon={<SettingsIcon size={14} aria-hidden />}
    title="Settings"
    href={settingsHref}
    onNavigate={onNavigate}
  />
  <MenuSeparator />
  <MenuItem
    icon={<LogOutIcon size={14} aria-hidden />}
    title="Log out"
    onSelect={signOut}
  />
</Menu>
```

- `Menu`: `label` (required), `trigger`, optional `anchor` to hang from a
  frame instead, `open` and `onOpenChange`, `side`, `align`, `motion`, and
  `error`, a refused action's reason shown as an alert line below the items.
- `MenuItem`: `title`, `icon`, `detail` (a line under the title),
  `disabled`, and either `onSelect` or `href`.
  - `onSelect(event)`: `event.preventDefault()` keeps the menu open, for an
    action that was refused and says why through `error`.
  - `href` with `onNavigate(href)`: a plain click goes to `onNavigate` for
    in-app routing; a modified click opens the link the browser's way.
- `MenuRadioGroup` (`value`, `onValueChange`) and `MenuRadioItem`
  (`value`, `title`, `tag`, `detail`): a choose-one list; the current choice
  carries a check. `tag` is a short neutral label beside the title ("Most
  common"); `detail` is one line or several, the first more prominent.
- `MenuSub` (`title`, `label`, `disabled`): an item that opens its own list
  beside the menu. Submenus are always instant.
- `MenuSeparator`.

## Dialog

`src/components/ui/dialog.tsx`. Use for a task that takes over the screen
for a moment. A dialog is centered over a scrim (`--overlay`, z-index 80)
and sits above every popover (z-index 81). Closing returns focus to what
had it when the dialog opened.

- `Dialog`: `label` (required; the content draws its own heading), `open`,
  `onOpenChange`, `size` (`default` 400px, or `wide` 480px with content that
  pins its own header and footer and scrolls only its body), `continued`
  (lands on a scrim already up, as after Plaid's window, so it doesn't fade
  in twice), and `autoFocus` (off focuses the dialog itself, so no control
  opens wearing a focus ring).
- `DialogScrim`: the scrim alone, for a window drawn by someone else with no
  backdrop of its own, like Plaid's. A `Dialog` with `continued` lands on it.

## ConfirmDialog

`src/components/ui/dialog.tsx`. Use for a question with two answers before
an action that can't be undone. Cancel takes focus on open and Escape
answers Cancel; a click outside does nothing.

```tsx
<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  trigger={<Button>Disconnect…</Button>}
  title={`Disconnect from ${name}?`}
  description="You’ll each keep a budget of your own."
  cancel="Cancel"
  confirm={pending ? "Disconnecting…" : "Disconnect"}
  tone="danger"
  onConfirm={() => disconnect.mutate()}
  pending={pending}
  error={error?.message}
/>
```

- `trigger` is optional. With it, focus returns to the trigger. Without it,
  as when a Cancel only sometimes asks first, the site opens it through
  `open` and focus returns to what had it when it opened.
- `tone` is `danger` or `primary`, the confirm button's variant.
- `onConfirm` leaves the dialog open; the site closes it once the work is
  done.
- `pending` disables both buttons and nothing closes the dialog.
- `error` shows why the work failed, above the buttons.

## Motion

**Default to instant.** Animation is reserved for occasional secondary
actions where the entrance connects the surface to its trigger. Pass
`motion="occasional"` to a `Popover` or `Menu` only when its surface is in
the occasional row:

| Frequency                    | Surfaces                                                                                                                                                                                                                                                         | `motion`             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Frequent work                | Ready to Assign, move money / cover overspending, create category/group, target behavior, reconcile, transaction entry and sharing, bulk categorizing/sharing, record purchases/repayments, request/pay partner, month picker, Reflect filters and chart details | `frequent` (default) |
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
  with their scrim. The values are in [scale.md](scale.md#motion).
- `prefers-reduced-motion: reduce` disables all of it.
- `Button` and `IconButton` don't scale on press while they carry
  `aria-haspopup`, so the surface can't measure a pressed trigger and jump.
  A hand-built trigger keeps still on press too.
