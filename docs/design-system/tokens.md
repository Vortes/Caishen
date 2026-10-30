# Color tokens

Source: `src/styles/tokens.css`. Components use the semantic layer only.

The primitives (`--violet-*`, `--green-*`, `--amber-*`, `--red-*`, `--hue`,
`--tint`) exist so the semantic layer has named values to point at. Never
reference them from a component. Changing a theme means changing which
primitive a semantic token points at, and that only works if nothing skips
the semantic layer.

```css
/* Correct */
.figure[data-state="overspent"] strong {
  color: var(--status-overspent);
}

/* Incorrect: a primitive, and a raw value */
.figure[data-state="overspent"] strong {
  color: var(--red-300);
}
.overlay {
  background: oklch(0 0 0 / 0.4);
}
```

## Surfaces

From the back of the window forward. Each step is lighter in dark mode.

```
What is the element?
 ├── The window behind every panel → --surface-app
 ├── A panel: sidebar, main content, inspector → --surface-panel
 ├── A plan group header or a date header row → --surface-group
 ├── A card, popover, or tooltip → --surface-raised
 ├── A row or quiet control under the pointer → --surface-hover
 └── The current detail row or pressed quiet control → --surface-selected
```

Rows selected for action use the grouped outline and accent mixes in
[rows.md](rows.md), not `--surface-selected` alone. The current detail row
and the checked selection are different states.

Buttons, tabs, and segmented controls have their own fills
(`--control-bg`, `--control-bg-hover`, `--control-bg-active`) and borders
(`--control-border`, `--control-border-active`). Use those only when building
a new kind of control, never for a surface.

A Monkeytype palette (`.root[data-palette]` in `shell.module.css`)
replaces the surface ladder with offsets from the palette's background.
When you add a gray token, add its offset there too, or it stays the
default theme's gray on every palette.

## Text

```
What is the text?
 ├── Names, values, headings, anything the user reads first → --text-primary
 ├── Supporting text, unselected controls, field labels → --text-secondary
 ├── Hints, captions, column headers, empty states, disclosure carets
 │    → --text-tertiary
 └── Text on --accent-solid → --text-on-accent
```

Never use opacity to dim text; pick a lower text token. Opacity mixes with
whatever is behind it, so the same text reads differently on each surface.
Disabled controls are the one exception, and the primitives already apply it.

## Borders

- `--border-subtle`: dividers between rows and sections. The default.
- `--border-card`: the edge of a card.
- `--border-strong`: checkbox outlines, tooltip edges, anything that must
  read as a boundary on its own.
- `--border-edge-lit`: the highlight on a panel resize handle. Nothing else.

## Color with meaning

Pick by what the color says, never by the hue you want.

```
What does the color communicate?
 ├── A category's funding state → --status-{funded, underfunded, credit,
 │                                 overspent, empty}, plus -bg for pill fills
 │                                 and --status-{funded, underfunded}-spent
 │                                 for a funding bar's spent segment
 ├── A signed amount outside a category (inflow, Ready to Assign)
 │    → --money-positive or --money-negative. Every inflow in a list
 │      is --money-positive; outflows stay --text-primary, because
 │      spending is the normal case and shouldn't read as an alarm
 ├── The user has to act (reconnect, pick a category)
 │    → --feedback-attention, plus --feedback-attention-bg
 ├── Something finished or is confirmed (cleared, all reviewed)
 │    → --feedback-success
 ├── The committing action → --accent-text and --accent-line, through
 │    Button variant="primary"
 ├── Rows selected for action → --accent-line for the outline and
 │    --accent-solid mixed into --surface-panel; see rows.md
 ├── A destructive confirm → --danger-text and --danger-line, through
 │    Button variant="danger"
 └── Checked boxes, the focus ring → --accent-solid, --focus-ring
```

Spent money in a funding bar uses `--status-funded-spent` or
`--status-underfunded-spent`: the status color mixed 45% into
`--surface-panel`, so it reads darker than unspent money in the dark theme
and paler in the light one. Use them only for the bar's spent segment;
everywhere else a status color appears at full strength.

`--status-empty` is a category with no target and $0.00 available. Its
text is `--text-primary`, so the Available amount reads as clearly as the
sidebar's balances. `--status-empty-bg` is lighter than `--surface-hover`
and `--surface-selected`, so the pill shows on hovered and current rows. A
snoozed category keeps `--text-secondary` on `--surface-hover`: it's paused,
so its amount steps back.

`--status-credit` is amber, like underfunded, not red: spending on a credit
card takes no cash, it adds card debt the plan hasn't funded yet. Only
`--status-overspent` (cash) is red.

Bars and meters: `--track` fills the part that isn't money yet (a funding
bar's still-needed segment, a meter's empty track). It is lighter than
`--surface-hover` and `--surface-selected` so it stays visible on any row
state.

```css
/* Correct */
.segment[data-kind="needed"] {
  background: var(--track);
}

/* Incorrect: the row's hover fill, so the track vanishes under the pointer */
.segment[data-kind="needed"] {
  background: var(--surface-hover);
}
```

Loading skeletons: `--skeleton-bone` fills a bone and `--skeleton-shine`
is the band that sweeps it. Only `Skeleton` uses them; a hand-drawn bone in
`--surface-selected` misses the shine and drifts if the bone color changes.

Shadows: `--shadow-card` for cards, `--shadow-drawer` for anything that
floats over content (drawers, popovers), `--shadow-tooltip` for tooltips.

Scrims: `--overlay` dims the page behind a dialog or an open drawer.
