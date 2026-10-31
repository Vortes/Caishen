# Text inputs

`src/components/ui/text-input.tsx` (`TextInput`) for any line of text that
isn't money, a date or a pick from a list ([fields.md](fields.md) has the
tree). It sits in a [`Field`](fields.md#field) and throws without one.

## TextInput

One line of text in the well. `value` and `onChange(value)` (always
controlled; `name` still sends it with a form), `type`, `placeholder`,
`autoComplete`, `required`, `minLength`, `maxLength`, `inputMode`,
`disabled`, `readOnly`, `inputRef`, `prefix`, `suffix`. Nothing else
exists. `WellInput`, also exported from `text-input.tsx`, is
`AmountInput`'s base; a screen never imports it.

- `type`: `"text"` (the default), `"email"` or `"password"`. Never
  `"number"`, and it can't be: it rejects `1,000` and shows spinners. A
  count takes `inputMode="numeric"`.
- `autoComplete`: `"off"` by default, which also keeps 1Password out, so
  it never fills money or a name into a well. Give the token only where
  the browser should fill the field: `"name"`, `"email"`, `"username"`,
  `"one-time-code"`, `"current-password"`, `"new-password"`. Nothing else
  exists.
- `required` and `minLength` are the browser's checks, for a form that
  relies on them (account settings, onboarding's account name). A screen
  that checks the value itself shows its message in the field's `error`.

`prefix` and `suffix` are short text in the well: `"%"`, `"years"`. They
are strings only, never an icon or a button, so every well keeps one look.
They are hidden from screen readers, so the label must name the field
without them, and it doesn't repeat them: "APR", not "APR (%)".

```tsx
// Correct (loan-setup-fields.tsx)
<Field label="APR" sharedErrorId={sharedErrorId}>
  <TextInput value={draft.annualRate} suffix="%" inputMode="decimal" onChange={setRate} />
</Field>

// Correct (account-settings.tsx): the browser fills it, and checks it
// before the form is sent
<Field label="New password">
  <TextInput
    name="password"
    type="password"
    autoComplete="new-password"
    minLength={8}
    required
    value={password}
    onChange={setPassword}
  />
</Field>

// Incorrect: money in a TextInput. No grouping, no arithmetic, no
// select on focus
<TextInput prefix="$" inputMode="decimal" value={amount} onChange={setAmount} />

// Incorrect: a raw input to get a password type or autofill, with its own
// well rules
<input className={styles.input} type="password" autoComplete="new-password" />
```
