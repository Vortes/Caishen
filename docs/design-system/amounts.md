# Amounts

`src/components/ui/amount-input.tsx` for every field a person types money
into, and `readAmount` in `src/components/budget/amount.ts` to read it. It
sits in a [`Field`](fields.md#field) like every other input. Any other line
of text is a [`TextInput`](text-inputs.md#textinput).

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
