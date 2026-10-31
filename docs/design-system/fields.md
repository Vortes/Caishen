# Fields

`src/components/ui/field.tsx` (`Field`, `FormError`, `FormFooter`),
`text-input.tsx` and `field-button.tsx`, over one stylesheet,
`field.module.css`, which
[`AmountInput`](amounts.md) and [`Select`](selects.md) share. Every field has one look: a label, a filled well, and a
hint or error under it. There is no variant, no size and no `className`.

```text
What does the person enter?
 ├── Money → AmountInput (amounts.md)
 ├── One option from a fixed list → Select (selects.md)
 ├── A value picked in a menu or popover the screen builds (a share, a
 │     target's behavior) → FieldButton
 ├── One item from a list they search by typing (a category, a payee)
 │     → a combobox: not in the system yet (TODO.md)
 ├── A date → not in the system yet (TODO.md)
 └── Any other line of text: a name, an APR, a count → TextInput
```

## Field

Every ui input sits in a `Field`; `TextInput`, `AmountInput`, `Select` and
`FieldButton` throw without one. The field gives its input an id, `aria-describedby` and
`aria-invalid`, so a screen never writes them for a ui input.

- `label`: required. `labelHidden` keeps it for screen readers only, where
  something on screen already names the field, such as a register's column
  header (`EditorCell` in `editor-row.tsx`).
- `hint`: a line under the well that stays.
- `error`: what to fix, under the well, with the field-error color
  (`--field-error`, `--field-error-line`; see [tokens.md](tokens.md)). It
  is read when someone reaches the field and is never announced: several
  errors at once would talk over each other. Only `FormError` announces.
- `sharedErrorId`: one error shown once for several fields, such as a
  register row's outflow and inflow or the three loan terms. Each field
  reads as invalid and is described by that id; the screen renders the
  message itself.
- `id`: only for a control that isn't a ui input yet (a combobox, a date).
  That control takes the id and points `aria-describedby` at `${id}-error`
  itself, as the move-money destination does.

```tsx
// Correct (account-entry.tsx)
<Field label="Opening balance" error={balanceError}>
  <AmountInput value={balance} placeholder="0.00" onChange={setBalance} />
</Field>

// Incorrect: the old hand-built field. Its wiring, its error and its well
// drift from every other copy
<div className={styles.field}>
  <label htmlFor={amountId}>Amount</label>
  <div className={styles.amountInput} data-invalid={invalid || undefined}>
    <span aria-hidden>$</span>
    <input id={amountId} inputMode="decimal" aria-describedby={`${amountId}-error`} />
  </div>
  <p id={`${amountId}-error`} role="alert">{message}</p>
</div>
```

## FormError and FormFooter

`FormError` (a string child) says why the whole form couldn't be sent, such
as a move the server refused. It is the one live region. Put it after the
last field, never inside a `Field`; an error about one field is that
field's `error`.

`FormFooter` sits under the fields behind a divider: `actions` (buttons,
end-aligned, 6px apart) and an optional note as `children`. It spans the
form edge to edge, so it goes outside the block that pads the fields.

```tsx
// Correct (move-money.tsx)
<div className={styles.fields}>
  {amountField}
  {destination}
  {error?.field === "form" && <FormError>{error.message}</FormError>}
</div>
<FormFooter
  actions={
    <>
      <Button size="sm" onClick={onDone}>Cancel</Button>
      <Button variant="primary" size="sm" type="submit">Move</Button>
    </>
  }
/>
```

## TextInput

One line of text in the well. `value` and `onChange(value)` (always
controlled; `name` still sends it with a form), `placeholder`, `maxLength`,
`inputMode`, `disabled`, `readOnly`, `inputRef`, `prefix`, `suffix`.
Nothing else exists. No `type`, so never `type="number"`: it rejects `1,000` and shows
spinners. `WellInput`, also exported from `text-input.tsx`, is
`AmountInput`'s base; a screen never imports it.

`prefix` and `suffix` are short text in the well: `"%"`, `"years"`. They
are strings only, never an icon or a button, so every well keeps one look.
They are hidden from screen readers, so the label must name the field
without them, and it doesn't repeat them: "APR", not "APR (%)".

```tsx
// Correct (loan-setup-fields.tsx)
<Field label="APR" sharedErrorId={sharedErrorId}>
  <TextInput value={draft.annualRate} suffix="%" inputMode="decimal" onChange={setRate} />
</Field>

// Incorrect: money in a TextInput. No grouping, no arithmetic, no
// select on focus
<TextInput prefix="$" inputMode="decimal" value={amount} onChange={setAmount} />
```

## FieldButton

A button drawn as the well, for a value the person picks in a `Menu` or
`Popover` the screen owns: the register's Share box, a target's "I want
to". `children` is the value shown; `placeholder` shows faint while there
are none; `suffix` ends the value with short faint text ("Half", then
"$12.50"); `chevron` marks a field that opens a list. `disabled`, `onClick`
and the other button attributes pass through, and it takes a `ref`, so a
`Menu` or `Popover` can make it its `trigger`. With the menu or popover
open, its border takes the focus color. `Select` draws its trigger the
same way.

It is named by the field's label and the value it shows ("I want to, Set
aside $0.00"), so a screen reader hears what's chosen.

```tsx
// Correct (target-editor.tsx)
<Field label={label}>
  <Menu label={label} trigger={<FieldButton chevron>{chosen.title}</FieldButton>}>
    …
  </Menu>
</Field>

// Incorrect: a button borrowing a screen's well class
<button className={`${entry.well} ${styles.trigger}`}>{chosen.title}</button>
```

A value from a fixed list that needs nothing but its label is a `Select`,
not a `FieldButton` with a hand-built menu.

## Layout

A field is a column: label, 6px, well, 6px, hint or error. Fields in a form
sit 12px apart ([spacing.md](spacing.md)). The well is `--size-control`
(32px) tall and fills its container's width; on touch it is 44px with 16px
text, so focusing it doesn't zoom the page. To put two fields side by side,
wrap them in a grid; never set a field's width or height.
