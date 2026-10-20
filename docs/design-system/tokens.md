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
 ├── A date header row inside a list → --surface-group
 ├── A card, popover, or tooltip → --surface-raised
 ├── A row or quiet control under the pointer → --surface-hover
 └── The selected row or pressed quiet control → --surface-selected
```

Buttons, tabs, and segmented controls have their own fills
(`--control-bg`, `--control-bg-hover`, `--control-bg-active`) and borders
(`--control-border`, `--control-border-active`). Use those only when building
a new kind of control, never for a surface.

## Text

```
What is the text?
 ├── Names, values, headings, anything the user reads first → --text-primary
 ├── Supporting text, unselected controls, field labels → --text-secondary
 ├── Hints, captions, column headers, empty states → --text-tertiary
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
 │                                 overspent}, plus -bg for pill fills
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
 │    Button variant="primary"; never set them directly
 ├── A destructive confirm → --danger-text and --danger-line, through
 │    Button variant="danger"
 └── Checked boxes, the focus ring → --accent-solid, --focus-ring
```

Spent money in a funding bar uses `--status-funded-spent` or
`--status-underfunded-spent`: the status color mixed 45% into
`--surface-panel`, so it reads darker than unspent money in the dark theme
and paler in the light one. Use them only for the bar's spent segment;
everywhere else a status color appears at full strength.

`--status-credit` is amber, like underfunded, not red: spending on a credit
card takes no cash, it adds card debt the plan hasn't funded yet. Only
`--status-overspent` (cash) is red.

Loading skeletons: `--skeleton-bone` fills a bone and `--skeleton-shine`
is the band that sweeps it. Only `Skeleton` uses them; a hand-drawn bone in
`--surface-selected` misses the shine and drifts if the bone color changes.

Shadows: `--shadow-card` for cards, `--shadow-drawer` for anything that
floats over content (drawers, popovers), `--shadow-tooltip` for tooltips.
