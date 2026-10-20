# Scale tokens

Source: the "Scale" block in `src/styles/tokens.css`. Never write a raw
`px` value for a font size, a control height, or a corner radius; use the
token. Raw pixels are fine for one-off geometry such as icon offsets and
hairline insets.

## Type

Five steps: 12, 13, 14, 16, 24. Nothing in between, nothing larger.

| Token            | Size | Use                                              |
| ---------------- | ---- | ------------------------------------------------ |
| `--type-caption` | 12px | Chart labels, avatar initials                    |
| `--type-small`   | 13px | Secondary text, captions, small buttons, tabs    |
| `--type-body`    | 14px | Default for everything, including medium buttons |
| `--type-title`   | 16px | A card's title                                   |
| `--type-figure`  | 24px | A card's headline amount, at most one per card   |

A screen's own title sits in the panel header at `--type-body`, weight 500,
like "Plan" or "Accounts › Checking". It is never larger: the chrome stays
quiet so the money is what stands out. A standalone prototype page without
the shell uses `--type-title` for its title.

Weights: 400 for text, 500 for controls and labels, 600 for titles and
figures. Amounts always use `font-variant-numeric: tabular-nums` so columns
of money line up.

The one exception to the scale: on touch devices, form fields use 16px.
Smaller fields make iOS Safari zoom the page when they get focus.

## Icons

Lucide icons, sized to the text beside them. Inside `Button` and
`IconButton`, don't pass `size`; the button sets it.

| Size | Use                                                            |
| ---- | -------------------------------------------------------------- |
| 12px | Carets and chevrons in tight spots: group toggles, breadcrumbs |
| 13px | Beside `--type-small` text: properties, action rows            |
| 14px | Beside `--type-body` text: sidebar items                       |
| 15px | Beside `--type-title` text: card titles                        |
| 18px | Full-panel status messages: loading, signed out                |

Decorative icons get `aria-hidden`. An icon that carries meaning on its own
gets `aria-label`.

## Heights

Everything that holds a line of text sits on these heights, so controls and
rows line up across panels.

| Token                   | Height | Use                                        |
| ----------------------- | ------ | ------------------------------------------ |
| `--size-badge`          | 20px   | The budget avatar                          |
| `--size-pill`           | 22px   | `Tag`, funding pills                       |
| `--size-control-xs`     | 28px   | `Button size="sm"`, `IconButton size="sm"` |
| `--size-control-sm`     | 30px   | Header controls: month picker, report tabs |
| `--size-control`        | 32px   | `Button`, `IconButton`, tab triggers       |
| `--size-row-sm`         | 34px   | Menu, property, and action rows            |
| `--size-row-md`         | 36px   | Sidebar items, column headers              |
| `--size-sidebar-header` | 40px   | The sidebar's top bar                      |
| `--size-row-lg`         | 44px   | Plan and register rows, date headers       |
| `--size-header`         | 48px   | Panel header                               |
| `--size-toolbar`        | 52px   | Toolbar under the header                   |

Popovers are `--size-popover` (320px) wide.

## Spacing

| Token            | Value | Use                                |
| ---------------- | ----- | ---------------------------------- |
| `--space-gutter` | 8px   | Between the window edge and panels |
| `--space-inset`  | 8px   | A panel's inner padding            |
| `--space-stack`  | 10px  | Between stacked cards              |
| `--space-row-x`  | 14px  | A row's horizontal padding         |
| `--space-card`   | 16px  | A card's padding                   |

## Radii

Inner radii are fixed. An outer radius is the inner radius plus the padding
between them, including a 1px border, so nested corners stay concentric.
Never pick an outer radius by eye.

| Token                | Value      | Use                                   |
| -------------------- | ---------- | ------------------------------------- |
| `--radius-row`       | 6px        | Rows, quiet controls, segmented items |
| `--radius-card`      | 12px       | Cards                                 |
| `--radius-segmented` | row + 3px  | A segmented control around its items  |
| `--radius-menu`      | row + 5px  | A popover around its rows             |
| `--radius-peek`      | row + 9px  | The peeking sidebar                   |
| `--radius-panel`     | card + 9px | A panel around its cards              |

Pills (buttons, tags) use `999px`; that is a shape, not a size.

## Motion

Panels open and close with `--duration-panel` (260ms) and `--ease-panel`.
Hover and press feedback is 150ms on color and 100ms on transform. Under
`prefers-reduced-motion`, panel motion is 0ms; never add animation that
ignores it.
