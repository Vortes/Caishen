# Fields

`src/components/ui/field.tsx` (`Field`, `FormError`, `FormFooter`),
`text-input.tsx` and `amount-input.tsx`, over one stylesheet,
`field.module.css`. Every field has one look: a label, a filled well, and a
hint or error under it. There is no variant, no size and no `className`.

```text
What does the person enter?
 ├── Money → AmountInput
 ├── One option from a fixed list → Select (choices.md)
 ├── One item from a list they search by typing (a category, a payee)
 │     → a combobox: not in the system yet (TODO.md)
 ├── A date → not in the system yet (TODO.md)
 └── Any other line of text: a name, an APR, a count → TextInput
```

## Field

Every ui input sits in a `Field`; `TextInput`, `AmountInput` and `Select`
throw without one. The field gives its input an id, `aria-describedby` and
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
controlled; `name` still sends it with a form), `placeholder`, `inputMode`,
`disabled`, `readOnly`, `inputRef`. No `type`, so never `type="number"`: it
rejects `1,000` and shows spinners.

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

## AmountInput

Money. It takes `TextInput`'s props except `prefix`, `suffix` and
`inputMode` (it sets `$` and the decimal keypad), plus:

- `align="end"`: the value ends where the column's figures do, for amounts
  under a register's Outflow, Inflow or Amount column. Everywhere else,
  leave it out.
- `negative`: the prefix reads `-$`. Only for one Amount column whose sign
  the row already fixes, as in the partner register: the person types the
  size and the prefix shows the direction.

What it does, with nothing for the screen to wire:

- Typing groups each number's thousands (`1200*12` → `1,200*12`), and the
  caret stays after the digit it followed.
- Focus selects the whole amount, so typing replaces it.
- Leaving the field: empty text stays empty; the screen judges it on
  submit. A plain amount (no operator, at most two decimals) stays as typed,
  so `1,000` stays `1,000`. A calculation, or digits past the cent, becomes
  the grouped result: `1200/12` → `100.00`, `84.20/3` → `28.07`,
  `12.345` → `12.35`. Text it can't read stays, and its `Field` shows the
  reason ("Enter an amount, such as 84.20 or 600+150."). The reason goes as
  soon as the text reads again.

Syntax, from `readAmount` in `src/components/budget/amount.ts`: `+`, `−`
or `-`, `×` or `*`, `÷` or `/`, `^`, and parentheses, with the usual order
of operations. `^` is right-associative and takes whole exponents only.
Unary minus works; `$`, commas and spaces are ignored. It is exact until the
end and rounds once, to the nearest cent, half away from zero. It refuses
division by zero, a fractional exponent and a result too large for cents.

On submit, the screen reads cents with `readAmount(value)`: `{ ok: true,
cents }` or `{ ok: false, message }`. Show `message` as the field's `error`.
Checks only the screen can make ("Enter an amount above zero", more than a
category has) also go through `error`, and the screen's error wins over the
input's own. To clear it as the person types, compare with
`sameAmount(before, next)` from the same file, so a rewrite on leaving
(`12.345` → `12.35`) keeps the error.

```tsx
// Correct (move-money.tsx)
const reading = readAmount(amount);
<Field
  label="Amount"
  error={error?.field === "amount" ? error.message : undefined}
>
  <AmountInput
    placeholder="0.00"
    value={amount}
    onChange={(next) => {
      if (!sameAmount(amount, next)) setError(null);
      setAmount(next);
    }}
  />
</Field>;

// Incorrect: parsing it yourself turns "600+150" into NaN
const cents = Math.round(Number(amount.replace(/[$,]/g, "")) * 100);
```

The plan's Assigned cell is the one amount entry that isn't an
`AmountInput`: a borderless input inside the plan row, reading with
`readAmount` and `groupThousands`. Don't copy it for a new field.

## The operator row

On a touch screen (`pointer: coarse`), while an `AmountInput` has focus and
isn't `readOnly`, a row of `+ − × ÷ ^ ( )` keys shows above the keyboard;
the decimal keypad has none of them. A key goes in at the caret, and focus
stays in the amount, so the keyboard stays up. The keys' names are "Plus",
"Minus", "Times", "Divide by", "To the power of", "Open parenthesis" and
"Close parenthesis". The row is part of `AmountInput`: there is nothing to
add, and no other input gets one. With a mouse, people type the operators.

## Layout

A field is a column: label, 6px, well, 6px, hint or error. Fields in a form
sit 12px apart ([spacing.md](spacing.md)). The well is `--size-control`
(32px) tall and fills its container's width; on touch it is 44px with 16px
text, so focusing it doesn't zoom the page. To put two fields side by side,
wrap them in a grid; never set a field's width or height.
