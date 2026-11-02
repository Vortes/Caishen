# Search lists

`src/components/ui/search-list.tsx`: `SearchList` and `SearchSuggestions`,
two components over one private row, built on the
[`Popover`](popovers.md) module at `size="trigger"` with `anchor`. Both
sit in a [`Field`](fields.md#field) and throw without one. The field's
well is the input, with a chevron, flush in the form like every other
well. The list floats under it and never grows the form. Focus stays in
the input; the arrow keys move a highlight through `aria-activedescendant`.

Two components, not one with a `mode` prop: they take different values
(an option's `value` against free text) and only `SearchList` has the New
and action rows, so one prop list would carry props that do nothing in
the other mode.

```text
What does the person enter?
 ├── One option from a short fixed list, picked without typing (an
 │     account type, a month) → Select (selects.md)
 ├── One option from a list they search by typing (a category, an
 │     account, who paid) → SearchList
 ├── Free text, with earlier entries offered (a payee, who owes it)
 │     → SearchSuggestions
 └── Free text with nothing to offer (a name, a note) → TextInput
```

## SearchList

`value` (the chosen option's `value`, `""` for none), `onChange(value)`,
`options`, `placeholder`, `disabled`, `readOnly`, `maxLength`, `inputRef`,
`onPicked`, `onCreate`, `action`, `displayValue`. Nothing else exists.

`options` are `{ value, label, group?, amount?, disabled? }`:

- `group`: a heading over each run of options with that group. Sort the
  options by group first; a heading shows wherever the group changes.
- `amount`: a balance in cents beside the option, in the open list only,
  toned positive, negative or zero. The closed field shows the label alone,
  so every list reads the same in a narrow column.
- `disabled`: shown dimmed and never picked, by click, Enter or Tab. Use it
  for an option the person needs to see but can't take, such as a category
  short of the amount to cover. Leave out options that never apply.

The rows above the options:

- `onCreate: { noun, create(name) }`: a New row pinned at the top
  ("New category “Rent”"). Enter takes it once nothing else matches.
  Only where the person can make the missing option on the spot (the
  register's category, a share's person).
- `maxLength`: the longest name the New row can carry, so the well stops
  typing where the server would refuse it (a share's person: 120).
- `action: { label, icon, onSelect }`: an action that shares the New row,
  such as the register's Split. It is not an option and never shows in
  the closed field.
- `displayValue`: the closed field's text for a value that isn't an option,
  such as "Split". Never a placeholder; that's `placeholder`.

What it does, with nothing for the screen to wire:

- Arriving (focus or a click) opens the list with the chosen name
  selected, so typing replaces it and filters by group and label.
- ArrowDown and ArrowUp open the list or move the highlight. Enter or a
  click picks and calls `onPicked`, for a form that moves on by itself.
- Tab takes the highlighted match once something is typed or an option is
  chosen, then moves on as Tab does; it never takes the New or action row.
  Before that, Tab only moves on. Typing "ren" and pressing Tab takes Rent.
- Escape closes only the list; the editor or popover around it stays open.
- On a phone the well is 44px with 16px text, so focusing it doesn't zoom
  the page, and rows are 44px (`--size-row-lg`), as in a `Select`.

```tsx
// Correct (move-money.tsx)
<Field label={label} error={error}>
  <SearchList
    value={value ?? ""}
    onChange={onChange}
    options={options.map((option) => ({
      value: option.id,
      label: option.name,
      group: option.group,
      amount: option.available,
      disabled: short(option),
    }))}
    placeholder="Choose a category"
  />
</Field>

// Incorrect: the old hand-built destination. Its own well, list, keys and
// error wiring, a search icon, and a list that grew the form
<Field id={id} label={label} error={error}>
  <div className={styles.search} data-expanded={expanded || undefined}>
    {expanded && <SearchIcon size={14} className={styles.searchIcon} />}
    <input id={id} role="combobox" aria-describedby={`${id}-error`} … />
  </div>
</Field>
```

## SearchSuggestions

Free text with earlier entries offered under the well. `value` and
`onChange(text)` carry what's typed, always. `suggestions` are strings,
most recent first; up to 8 that match show. `placeholder`, `disabled`,
`readOnly`, `maxLength`, `inputRef` and `onPicked` work as above.

`destinations`, `destination` and `onDestination(value)` add options that
aren't free text, listed first under their groups, with the suggestions
under the field's label. Only the register's Payee has them: a transfer's
account. A screen without such options leaves all three out.

- A suggestion is taken only with the arrow keys then Enter, or a click.
  Enter on typed text sends the form, so a suggestion never replaces what
  was typed unless the person picks it.
- There is no New row, no Tab pick and no disabled option; whatever is
  typed is already the value.
- Escape closes only the list.

```tsx
// Correct (share-field.tsx)
<Field label="Who owes it" error={error?.field === "name" ? error.message : undefined}>
  <SearchSuggestions
    inputRef={nameInput}
    value={name}
    suggestions={people}
    placeholder="Name or company"
    onChange={(value) => {
      setName(value);
      setError(null);
    }}
  />
</Field>

// Incorrect: the browser's datalist, drawn differently in each browser,
// in a borrowed well
<div className={moveStyles.amountInput}>
  <input id={nameId} list={listId} value={name} onChange={…} />
  <datalist id={listId}>
    {people.map((person) => <option key={person} value={person} />)}
  </datalist>
</div>
```
