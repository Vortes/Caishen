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
