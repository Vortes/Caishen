# Select

`src/components/ui/select.tsx`, built on the [`Popover`](popovers.md)
module at `size="trigger"`. Use for one value from a fixed list in a form:
an account type, a month, a weekday. A list the person searches by typing
(a category, the move-money destination) is a combobox, which isn't in the
system yet. A list of actions is a [`Menu`](menus.md).

`value`, `onChange(value)`, `options` (`{ value, label }[]`), `name` (a
hidden input sends the value with the form), `placeholder` (shown while the
value matches no option), `disabled`, and `inputRef` for a form that
focuses the select after a failed save. No option groups, no icons or
custom content in a row; none of the 11 selects need them.

It sits in a [`Field`](fields.md#field), which names it, describes it and
marks it invalid; the list takes the field's label as its name. It looks
like the field's well with a chevron (the same button as
[`FieldButton`](fields.md#fieldbutton)), and its list rows are a `Menu`'s
choose-one rows: the current choice carries a check.

- Opening: a click, or ArrowDown or ArrowUp on the well. Focus goes to the
  current choice, or the first option when nothing is chosen.
- In the list: the arrow keys move, Home and End reach the ends, and typing
  jumps to the next option that starts with what's typed. Enter, or Space
  when nothing is being typed, picks. Escape closes without picking. Either
  way focus returns to the well.
- On a phone it opens as a `Menu` does: a list under the well, with 44px
  rows and 16px text.

```tsx
// Correct (account-entry.tsx)
<Field label="Account type" hint={hint}>
  <Select
    value={kind}
    onChange={(next) => setKind(next as NewAccountKind)}
    options={kinds}
  />
</Field>

// Incorrect: a native select styled by hand, outside a Field
<select className={styles.select} value={kind} onChange={pick}>
  {kinds.map((kind) => <option key={kind.value}>{kind.label}</option>)}
</select>
```
