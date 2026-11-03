# Rows and selection

## Selectable rows

Use [Register](register.md) for checkable or selectable records with a
column header. It owns the register's grid, selection gestures, checkboxes,
editor placement and Action Bar slot. Its callers supply state and contents.

Plain rows that join an action set use the grouped outline below and a named
[`Checkbox`](../../src/components/ui/checkbox.tsx). Navigation and open
details use the current-row state; hover and keyboard focus are separate.

Reuse `src/components/ui/row-selection.module.css` (`list` and `row`) and
`src/components/ui/use-row-selection.ts` (`useRowSelection`) for the grouped
outline. Motion tokens live in `src/styles/tokens.css`.

Apply `list` and `listProps` to the list or table, and `row` and
`rowProps(id)` to each selectable row wrapper or `<tr>`. Table outlines are
drawn on cells so the first and last cells retain rounded outer corners.
`PlanView` with `PlanCategoryContents` in
[`views.tsx`](../../src/components/app-shell/views.tsx) is the plain-row
call site. Plan and Loans import [`moveSelection`](../../src/components/ui/move-selection.ts)
for arrows; Plan uses [`RowCheckbox`](../../src/components/ui/row-checkbox.tsx).
The Register owns its checkbox and [`SelectAll`](../../src/components/ui/select-all.tsx);
register callers supply state instead of another selection handler.

### States and defaults

The grouped outline is the only row-selection treatment. Do not introduce
feature-specific selection variants.

- **Unselected:** preserve the row's normal surface. Hover uses
  `--surface-hover`; the current detail row uses `--surface-selected`.
- **Selected:** draw a 1px inset outline in `--accent-line`, with a fill of
  `color-mix(in oklch, var(--accent-solid) 6%, var(--surface-panel))`.
- **Selected and hovered:** keep the outline; increase the fill's accent
  share to 11%. Hover must not erase selection.
- **Keyboard focus:** retain the existing 2px `--focus-ring` focus indicator
  independently of selection. A selected row can also contain a focused
  checkbox or control.

Outline and fill cover the whole row, including its checkbox area, without
changing dimensions or column alignment. Use inset shadows and layered
pseudo-elements, not a border that changes layout. Keep decoration
`pointer-events: none` so row controls remain clickable.

### Nothing moves

Selecting, hovering, focusing, or opening a row to edit moves no text, not
by a pixel: text keeps its left edge, an amount its right, all their tops.

- Draw state with fills, inset shadows and outlines, never with borders.
- Follow [Register](register.md#layout-and-interaction) for column and input
  alignment: `.columns` lives in [`register.module.css`](../../src/components/ui/register.module.css);
  editor wells live in [`transaction-entry.module.css`](../../src/components/app-shell/transaction-entry.module.css).
- `tests/e2e/shell-register-edit-in-place.spec.ts` compares the painted
  glyphs of a register and a partner row; a one-pixel shift fails it.

### Contiguous selection

Adjacent selected sibling rows form one outlined group, not separate pills:

- Keep a 1px left and right edge on every selected row.
- Draw the top edge and round the top corners only on the first selected
  row in a run; draw the bottom edge and round the bottom corners only on
  the last. Use `--radius-row` (6px).
- Internal joins have square corners and no horizontal selection edge.
- A single selected row has all four edges and all four rounded corners.
- An unselected row, section heading, or editor breaks the run. Never join
  selection outlines across these boundaries.

### Reference examples

The reference uses a presence attribute for checked membership; omit the
attribute when false. `data-checked="false"` still matches `[data-checked]`.

Correct: `PlanCategoryContents` in [`views.tsx`](../../src/components/app-shell/views.tsx)
(excerpt). Register callers delegate this wrapper to [Register](register.md).

```tsx
className={`${styles.rowWrap} ${selectionStyles.row}`}
{...selectionStyle.rowProps(id)}
```

```css
/* Incorrect for new selectable rows: the older fill-only treatment. */
.rowWrap[data-checked] > .row {
  background: color-mix(
    in oklch,
    var(--accent-solid) 16%,
    var(--surface-panel)
  );
}
```

### Motion

Use `--duration-selection` (160ms) and `--ease-selection`
(`cubic-bezier(0.165, 0.84, 0.44, 1)`) from the reference implementation.
Do not add per-feature timing values.

- Fade the outline and fill in. Newly checked rows use `data-entering` to
  transition opacity only, so their edges appear in the final group shape.
- Existing selected neighbors animate their corners and edge shadows when
  the group's shape changes.
- Fade deselection out over 120ms (`--duration-selection * 0.75`) with
  `ease-in`. Delay the corner and shadow reset until the fade finishes;
  resetting first would flash a different outline while it is visible.
- Fill color changes use 150ms `ease`.
- Keyboard interaction sets `data-instant` on the list and disables these
  transitions. The shared hook captures input on the list; pointer
  interaction restores transitions. Under
  `prefers-reduced-motion: reduce`, always disable selection transitions.

### State choice

```text
What does the row state mean?
 ├── Included in an action set → grouped selection outline + Checkbox
 ├── Currently open in a detail view → current-row surface
 ├── Under the pointer → hover surface
 └── Receiving keyboard input → focus-visible indicator
```

These states can coexist. Apply the selected fill over the underlying
hover/current surface and preserve keyboard focus; do not substitute one
state's styling for another.

## Group headers

Plan category groups use header rows. The Register's Pending heading and
count use `sections`; follow the [Register page](register.md).

- `--surface-group` fill, `--size-row-lg` tall, `--radius-row` corners,
  4px above it and 4px between it and its first row. Rows within a group
  stay flush so selection runs join.
- Name in `--text-secondary` at weight 500; `--text-primary` on hover.
  Group totals in `--text-tertiary` at weight 400.
- In a column of pills, the header label and group total inset by the
  pill's 8px side padding, so their text lines up with the pill labels
  instead of the pill edges.
- On a collapsible group, a `ChevronDownIcon` caret (12px, stroke 2.5)
  in `--text-tertiary` before the name. Collapsed, it rotates -90° over
  150ms with `--ease-panel`.
- No category count beside the name.

Copy `.groupRow`, `.groupName`, and `.groupCaret` from `shell.module.css`
until the `Row` primitive exists.
