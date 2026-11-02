# Popovers

Read [surfaces.md](surfaces.md) first, for `SurfaceProvider` and motion.

## Popover

`src/components/ui/popover.tsx`. Use for a small form, a list under a field,
or a detail panel that hangs from the thing it acts on.

- A list of actions, links or one choice from a few: use a [`Menu`](menus.md).
- A task that takes over the screen, or a question before an action that
  can't be undone: use a [`Dialog` or `ConfirmDialog`](dialogs.md). An
  action the toast's Undo restores commits from the popover itself.
- A short name or shortcut on hover: use a `Tooltip`.

Never build a popover from Radix or a positioned `div`. The module owns the
portal, the 6px gap, the window-edge clearance, the z-layer, the surface
tokens, the height clamp and the motion; a hand-built one gets one of them
wrong. If the interface can't express what a site needs, widen the module in
`src/components/ui`.

```tsx
// Correct (reconcile.tsx)
<Popover
  label={`Reconcile ${account.name}`}
  trigger={children}
  open={open}
  onOpenChange={setOpen}
  align="end"
  size="form"
  arrow
>
  <ReconcileForm
    account={account}
    reconcile={reconciling.reconcile}
    onDone={() => setOpen(false)}
  />
</Popover>

// Incorrect: Radix directly, a hand-picked offset and a borrowed recipe
<RadixPopover.Content sideOffset={8} className={moveMoney.popover}>
  <ReconcileForm … />
</RadixPopover.Content>
```

### Width: `size`

`form`, `wide` and `trigger` are the only sizes; they name what the content
is, not how big it is. Nothing else exists, and `className` and `style` are
not props.

```text
What is inside?
 ├── A list that filters as the user types in a field → size="trigger"
 │     (the field's width, never under 20rem; long rows truncate)
 ├── A table of transactions, or a SearchListDetail (a list beside the
 │     highlighted row's detail) → size="wide" (--size-popover-wide, 560px)
 ├── A form → size="form" (--size-popover, 320px). The default choice.
 └── A grid with a natural width of its own (month picker, date calendar)
       → no size; the content sets the width
```

Omit `size` only for content that has a fixed natural width. A form without
a size grows with its longest label and every form ends up a different
width.

### Mode: `trigger` or `anchor`

```text
What opens it?
 ├── A button
 │    ├── It should hang from the button → trigger={button}
 │    └── It should hang from a frame around the button (the selection
 │        island) → trigger={button} anchor={frame}
 └── Something else the site controls (an input, a field's "New" row,
     a chart slice) → anchor={element} open onOpenChange
      ├── Focus must stay in the input while the user types → no autoFocus
      │     (the site handles Escape)
      └── It is a form or panel the user moves into → autoFocus
            (takes focus, closes on Escape, a click on the anchor closes it)
```

```tsx
// Correct: a list under an input (search-list.tsx)
<Popover
  label={control.label}
  size="trigger"
  open={open}
  onOpenChange={(next) => {
    if (!next) setExpanded(false);
  }}
  anchor={<div className={field.well} data-well="">…</div>}
>
  <div role="listbox" id={listId} aria-label={label}>…</div>
</Popover>

// Incorrect: a trigger around an input moves focus out of it on open
<Popover label={label} size="trigger" trigger={<input … />}>…</Popover>
```

### Other props

| Prop               | Default                 | Set it when                                                                                    |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `label`            | required                | Always. It is the accessible name tests and screen readers find it by                          |
| `side`             | `bottom`                | The trigger sits at the bottom of the window (`top`), as Add account does                      |
| `align`            | `start`                 | The trigger is at the right of its row (`end`), or the popover centers on a point (`center`)   |
| `motion`           | `frequent` (instant)    | Only for the occasional surfaces in [surfaces.md](surfaces.md#motion)                          |
| `arrow`            | off                     | A form acts on the one thing it hangs from (reconcile, assign money, a chart slice)            |
| `autoFocus`        | on with `trigger`       | Off when the content focuses something itself, as the month picker focuses the current month   |
| `onCloseAutoFocus` | focus returns to opener | `event.preventDefault()` when the site focuses what the popover just made, like a new category |
| `id`               | none                    | A field names the popover in `aria-controls`                                                   |

Never pass `side` or `align` to dodge the window edge; the module flips and
shifts the surface. They say where the trigger is, not where there is room.

### Escape

Escape closes the popover, except where a control inside uses it first: an
open list under a field closes, a search with text clears. That control
carries `data-holds-escape` while it does, and the popover stays open for
that press. The ui controls already set it (`SearchList`,
`SearchSuggestions`, `SearchListDetail`, `DateField`); a screen never
does.

### Height

The surface is clamped to the room on its side and scrolls as a whole. A
form opened low on the page flips above its trigger when it fits there.

Content that pins a header or footer scrolls only its body. The surface is a
flex column, so the content's root takes `display: flex`,
`flex-direction: column` and `min-height: 0`, and its body takes
`min-height: 0` and `overflow-y: auto`. A cap of its own is a plain
`max-height` on that root.

```css
/* Correct (activity.module.css) */
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 420px;
}

/* Incorrect: a Radix variable in a screen's CSS; the surface already clamps */
.panel {
  max-height: min(420px, var(--radix-popover-content-available-height));
}
```

### Layout and stacking

- The surface adds no padding. The content sets its own inset: 12px for a
  form, 4px for a list of rows ([spacing.md](spacing.md)).
- It clears the window edge by 12px on every side except the edge it aligns
  to, so a trigger at the edge (Banks in the sidebar) keeps its surface
  flush with that edge. `align="center"` clears all four.
- A popover opened from inside another sits above it, by mount order. Every
  dialog sits above every popover. There is no layer prop.
