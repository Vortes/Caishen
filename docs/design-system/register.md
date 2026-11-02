# Register

## Register

[`src/components/ui/register.tsx`](../../src/components/ui/register.tsx)
and its [stylesheet](../../src/components/ui/register.module.css). Use for
checkable or selectable records with a column header: Transactions, the
Partner ledger and Reimbursements. Use [plain rows](rows.md) for the Plan
and Loans; they keep their own row structure and `moveSelection` calls.
Plan also uses `useRowSelection` directly.

There are no variants or sizes. `className` and `style` are not props.
The caller supplies records, cell contents, editor and [Action Bar](action-bar.md).
The Register owns the header, row frames, checkboxes, selection gestures,
keyboard navigation and focus after editing. Keep those rules here so a
new register gets the same behavior.

- `rows` contains records with a unique string `id`, already filtered and
  sorted by the caller. The Register does neither.
- `columns` gives each header a `key` and `label`. `optional` hides its
  header at narrow widths; `numeric` right-aligns it with tabular numbers.
  A React element in `label` supplies its own header cell, as Transactions
  does for its wide Outflow/Inflow and narrow Amount headers.
- `cells(row)` returns `label` and `content`. `label` names the row's
  checkbox. Put `data-column` on content cells to identify the field a
  pointer opens; mark optional content with `data-optional` too. Optional
  `controls` render beside the row button, for Share and cleared toggles,
  rather than nesting interactive controls inside it. `openColumns` limits
  the fields passed to `onOpen`; `attributes` adds `data-*`, `title` or
  `aria-expanded` to the row button.
- `selectedId` and `onSelect(id)` control the current row. `checked` and
  `onCheck(ids, value)` control membership in the action set. The caller
  stores these states; the Register handles the gestures that change them.
- Supply `checkable(row)` when rows can join an action set. A false result
  leaves that row selectable and openable but excludes it from checkboxes,
  ranges, `x` and Select all. Transactions uses `row.actions.select`;
  the Partner uses its categorization eligibility.
- Omit `checkable` when the register never checks rows, as Reimbursements
  does. Pass `checked={[]}` and a no-op `onCheck`. It renders no checkboxes,
  Select all or checked styling, and its current-row frame stays square.
- `onOpen(row, column?)` decides what opening means and whether it is
  allowed. Transactions starts its editor at the clicked field; the Partner
  opens its ledger editor; Reimbursements jumps to the source transaction.
  A keyboard open has no column.
- `editingId` replaces the matching row with `renderEditor(row)`. An id
  absent from `rows` calls `renderEditor(undefined)` in the sticky dock
  below the header, for a new or filtered-out transaction. The caller
  closes its editor by clearing `editingId`.
- `sections` supplies the Pending group: `key`, `label`, optional
  `aria-label`, `rows`, `open` and `onOpenChange`. Include those records in
  `rows` too; the Register removes their ordinary-row copies. Collapsed
  rows leave ranges and Select all; an open editor stays visible when its
  section closes. See `RegisterView` in
  [`views.tsx`](../../src/components/app-shell/views.tsx).
- `empty` supplies the empty view. `noMatch`, when supplied, takes priority
  over it when `rows` is empty and there is no docked editor. The caller
  decides which message fits its filter; the Register hides the header.
- `actionBar` renders after the rows. Transactions passes `TransactionActions`;
  the Partner passes `PartnerActions` with its Open in account destination.
  Keep eligibility, actions and callbacks in those callers. The frame is
  [`ActionBar`](action-bar.md), not another selection implementation.
- `aria-label` names the register group and defaults to Register. `ref`
  exposes its root div; root `data-*` attributes are also accepted.

### Layout and interaction

Set column widths through `layout`, as all three callers do. Its required
`wide` and optional `narrow`, `compact` and `gutter` feed `--columns-wide`,
`--columns-narrow`, `--columns-compact` and `--row-gutter`. Without `layout`,
tracks come from `columns`: numeric columns get `6.5rem`, others get
`minmax(0, 1fr)`, and narrow tracks omit optional columns.

The shared stylesheet switches at container widths of 760px and 480px.
Its `.columns` aligns the header, rows, overlaid controls and editors with
a whole-pixel 20px line so opening an input does not move its text.
Editors import that grid; their field wells and stacked form layout stay
in [`transaction-entry.module.css`](../../src/components/app-shell/transaction-entry.module.css).
Keep register grids in `register.module.css`; use `layout` for caller
widths, rather than per-register CSS overrides.

Click selects; Enter only selects, including on the current row. A second
pointer click opens at the clicked column. Double-click opens without
selecting a word. Arrows move focus and selection, `x` toggles the focused
checkable row, and `e` opens the selected row. Shift-click checks or unchecks
the range from the last clicked row. Select all covers visible checkable
rows and clears them when any are checked. Closing an editor returns focus
to its row if it is still rendered and focus was left on the document body.
These rules live in `register.tsx`, with coverage in
[`ui-register.test.tsx`](../../tests/components/ui-register.test.tsx).

The Register reuses
[`useRowSelection`](../../src/components/ui/use-row-selection.ts) and its
[`stylesheet`](../../src/components/ui/row-selection.module.css),
[`moveSelection`](../../src/components/ui/move-selection.ts),
[`SelectAll`](../../src/components/ui/select-all.tsx) and
[`RowCheckbox`](../../src/components/ui/row-checkbox.tsx). They remain
separate for plain rows to use. Register callers supply state and contents
instead of calling these helpers again.

### Examples

Correct: the selection and opening props from `ReimbursementsRegister` in
[`reimbursements-register.tsx`](../../src/components/app-shell/reimbursements-register.tsx)
(excerpt). The full call omits `checkable`: opening goes to the transaction,
and there is no checked-row action set.

```tsx
rows={rows}
selectedId={selectedId}
onSelect={onSelect}
checked={[]}
onCheck={() => {}}
onOpen={(entry) =>
  onJump({
    id: entry.transactionId,
    accountId: entry.accountId,
    date: entry.date,
  })
}
```

Incorrect for a Register caller: the replaced Partner grid override in
[`partner-register.module.css`](../../src/components/app-shell/partner-register.module.css)
before #249 (`git show a02f7a9b^:src/components/app-shell/partner-register.module.css`).
The doubled selector used to outrank the shell grid. `PartnerRegister` now
passes those widths through `layout` in
[`partner-register.tsx`](../../src/components/app-shell/partner-register.tsx).

```css
.register.register {
  --tx-columns: 5.5rem minmax(0, 1.4fr) minmax(0, 1fr) 7rem 7rem 16px;
  padding-top: 6px;
}
```

```text
Does the list need selectable records with a column header?
 ├── No → use plain rows
 └── Yes → use Register
      ├── Rows join an action set → supply checkable and an Action Bar
      └── Rows only select and open → omit checkable
```
