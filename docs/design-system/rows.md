# Rows and selection

## Selectable rows

Use the transaction register's grouped outline whenever a table or list lets
the user select rows for an action, including plan categories and future
features. Use a named `Checkbox` from `src/components/ui/checkbox.tsx` to
toggle membership. For navigation or an open detail row, use the current-row
state instead; hover and keyboard focus are not selection.

Reuse `src/components/ui/row-selection.module.css` (`list` and `row`) and
`src/components/ui/use-row-selection.ts` (`useRowSelection`). They generalize
the grouped-outline design from commit `7390a0c`; do not copy its
register-specific CSS. Motion tokens live in `src/styles/tokens.css`.

Apply `list` and `listProps` to the list or table, and `row` and
`rowProps(id)` to each selectable row wrapper or `<tr>`. Table outlines are
drawn on cells so the first and last cells retain rounded outer corners.
Real call sites: `PlanView` and `RegisterView` in
`src/components/prototype/app-shell/views.tsx`, `CategoryTable` in
`src/components/budget/category-table.tsx`, and `TransactionRegister` with
`TransactionRow` in `src/components/transactions/`.

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

This makes selection read as one set without doubling outlines between rows.

### Reference examples

The reference uses a presence attribute for checked membership; omit the
attribute when false. `data-checked="false"` still matches `[data-checked]`.

```tsx
// Correct: RegisterView, selection on the whole row wrapper
<div
  key={item.id}
  className={`${styles.rowWrap} ${reviewStyles.checkable} ${selectionStyles.row}`}
  {...selectionStyle.rowProps(item.id)}
>
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
