# Action Bar

## ActionBar

[`src/components/ui/action-bar.tsx`](../../src/components/ui/action-bar.tsx)
and its [stylesheet](../../src/components/ui/action-bar.module.css). Use for
actions on checked register rows. Use the register's toolbar or account
summary for actions independent of checked rows, such as Add transaction or
Request. Use a [`Menu`](menus.md) for an action list and a
[`Popover`](popovers.md) for a form opened from the bar.

There are no variants or sizes. `className` and `style` are not props.
The frame owns placement, the count, Clear selection, dividers and an
optional navigation button. The caller owns checked rows, callbacks,
eligibility, disabled states and the actions in `children`.

- `count` is required: pass the number of checked rows, not the current
  detail row or the number of eligible actions. A nonzero count renders
  `role="toolbar"` with the label **Selected transactions** and a polite
  live summary. Keep that label.
- Supply `onClear` whenever rows are checked. The count is a `subtle`, `sm`
  button named Clear selection, with an Esc tooltip. The caller handles
  Escape; the frame does not install a keyboard handler.
- `way` defaults to `null`. A `Way` has `name`, `label`, `onGo` and optional
  `forward`. Use `name` for the short destination and `label` for its full
  accessible name and tooltip. `forward` defaults to a back arrow; `true`
  uses the outward arrow, as Open in Checking does in a person's register.
- With zero checked rows, `way` alone stays visible without a count,
  actions or toolbar role. With no `way`, the frame renders nothing.
- `hint` is an optional string or `false`. It appears beside the count in
  `--feedback-attention`, as the transaction review limit does. Omit it
  when there is no constraint to explain.

Correct: the checked-row frame from `PersonActions` in
[`person-register.tsx`](../../src/components/app-shell/person-register.tsx).
It clears the same rows it counts and keeps categorization in the caller.

```tsx
<ActionBar
  count={selected.length}
  onClear={() => onCheck(ids, false)}
  way={way}
>
  <CategorizeAction
    count={selected.length}
    disabled={disabled}
    onCheck={onCheck}
    categorize={(categoryId) =>
      entry.categorizePartnerEntries(
        selected.map((row) => ({ rowId: row.id, entryId: row.entryId! })),
        categoryId,
        (rowId) => onCheck([rowId], true),
      )
    }
  />
</ActionBar>
```

Incorrect **when rows are checked**: this navigation-only call is taken
from `TransactionActions` in
[`transaction-review.tsx`](../../src/components/app-shell/transaction-review.tsx).
That site correctly guards it with `if (!selected.length)`. Using it for a
nonempty selection hides the count, Clear selection and all actions.

```tsx
<ActionBar count={0} way={back} />
```

```text
Are any rows checked?
 ├── Yes → count={selected.length}, onClear, and eligible action children
 └── No → Is there a destination to keep visible?
      ├── Yes → count={0} way={destination}
      └── No → count={0}; renders nothing
```

### Contents, placement and anchors

- `TransactionActions` in `transaction-review.tsx` supplies Approve,
  Enter now, Reject, Categorize and Share according to eligibility. Its
  first review action is `primary`; other actions use the default
  `secondary`. `PartnerActions` supplies Categorize and the optional
  Open in account destination. Every action uses `Button size="sm"`.
- Pass the bar through [`Register`'s `actionBar` prop](register.md).
  The sticky `.slot` centers it at the scrolling register's foot;
  `register.module.css` owns the flex column and bottom padding that leave
  the last row reachable above the bar. Keep that layout in the Register.
- The frame uses `--surface-raised`, `--border-strong`, `--shadow-drawer`
  and `--type-small`. The count uses tabular numbers. Destination names
  truncate at 18ch while their full label remains accessible.
- At a container width of 560px or less, the frame and actions wrap,
  dividers disappear and the frame uses `--radius-menu`. Coarse pointers
  use `--size-row-lg` controls. Do not add per-register overrides.
- Import `.anchor` from `action-bar.module.css` for a surface opened from
  an action. It measures the frame's outer border even when actions wrap.
  `CategorizeAction` uses it with `Menu`; `ShareSelection` in
  [`share-selection.tsx`](../../src/components/app-shell/share-selection.tsx)
  uses it with `Popover size="form"`. Both use `side="top"`, `align="end"`
  and the default frequent, instant surface motion.
