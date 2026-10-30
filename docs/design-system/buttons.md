# Buttons

## Button

`src/components/ui/button.tsx`. Use for any action with a text label. An
action with only an icon is an `IconButton`. Something that moves to another
place is a link; when a link must look like a button, use
`<Button asChild><a href="…">…</a></Button>`.

Variants: `primary`, `secondary`, `subtle`, `quiet`, `quiet-primary`, `danger`.
Sizes: `md`, `sm`. Nothing else exists.

- `secondary` is the default and covers almost every button.
- `subtle` keeps the padded pill hit area but shows its background only on
  hover or keyboard focus, as with Clear selection in the selection island.
- `primary` is the surface's main action: one that commits something (Save,
  Assign, Apply, Mark reviewed) or starts the flow that fixes what the
  surface is about. At most one per card, popover, or dialog. Two primaries
  means the surface has no hierarchy.
- `quiet` is for inline actions inside rows, sections, and popover headers,
  where a pill would be heavier than the content around it: Select all,
  Show all dates, Create target.
- `quiet-primary` is `primary` where it sits inline in a row: the label in
  the accent color with no pill, so it lines up with the row's text and
  keeps the row's height. Reconnect on the one bank that signed out, in the
  Banks popover. It is the surface's primary, so it counts toward the one per
  surface; when several rows need the same fix, none is the main action and
  each is `quiet`.
- `danger` is only the confirm button inside a destructive dialog, such as
  Delete category. The button that opens that dialog is `secondary`, so a
  red button always means "this happens now".

```
Is the button the surface's main action?
 ├── Yes → Is that action destructive or hard to undo?
 │    ├── Yes → variant="danger", inside a confirm dialog
 │    └── No → Does it sit inline with text or rows?
 │         ├── Yes → variant="quiet-primary"
 │         └── No → variant="primary"
 └── No → Does it sit inline with text or rows?
      ├── Yes → variant="quiet"
      └── No → variant="secondary" (default)
```

`md` (32px, 14px text) is the default. `sm` (28px, 13px text) is for
toolbars, popover footers, and filter rows, where several buttons sit in a
line. Never mix sizes in one row of buttons.

Put the icon in `children`, before or after the label; the button sizes it.
A secondary button that toggles something on (a filter, a setting) gets
`aria-pressed`, which gives it the pressed look.

Popup triggers (`aria-haspopup`) never scale on press, for either `Button`
or `IconButton`. Radix measures the trigger during the press; shrinking it
moves the anchored surface before it closes and again when the press ends.

```tsx
// Correct: one primary, the rest secondary, icon as a child
<Button size="sm" aria-pressed={reviewOnly} onClick={toggleReview}>
  <span className={styles.reviewDot} data-on data-inline />
  To review
</Button>
<Button size="sm" onClick={() => setOpen(false)}>
  Done
</Button>
<Button variant="primary" size="sm" type="submit">
  Apply
</Button>

// Incorrect: shadcn variants that don't exist here, an icon prop, and a
// className to restyle it
<Button variant="ghost" icon={<FilterIcon />} className="text-red-500">
  Filter
</Button>
```

A `Button` that is a direct child of a flex column stretches to the
column's width. To keep its natural width there, put it in a plain `<div>`;
to span the card, as Ready to Assign does, leave it unwrapped. In a flex row
it keeps its natural width, so never wrap it.

## IconButton

`src/components/ui/icon-button.tsx`. Use for an action shown only as an icon.
If the action has room for a word, use `Button`; icons alone are ambiguous.

Variants: `quiet`, `secondary`. Sizes: `md`, `sm`. Nothing else exists.

- `quiet` is the default: on a surface with nothing around it, like the
  sidebar header or a card title's ⋯ menu.
- `secondary` is the bordered round pill, only in toolbars where it sits
  next to secondary buttons.

`label` is required. It is both the accessible name and the tooltip, so
write it as the action ("Previous month", "Hide details"), not the icon
("Chevron"). Pass `shortcut` when a key triggers it; it shows in the tooltip.
`pressed` marks a toggle that is on, like the details panel being open.

```tsx
// Correct
<IconButton
  label={inspectorState.collapsed ? "Show details" : "Hide details"}
  shortcut="]"
  variant="secondary"
  pressed={!inspectorState.collapsed}
  onClick={inspector.toggle}
>
  <PanelRightIcon aria-hidden />
</IconButton>

// Incorrect: a raw button with no name and a hand-set icon size
<button className={styles.iconButton} onClick={next}>
  <ChevronRightIcon size={14} />
</button>
```

Don't wrap an `IconButton` in a `Tooltip`; it already has one.
