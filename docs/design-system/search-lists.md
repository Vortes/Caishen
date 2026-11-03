# Search lists

`src/components/ui/search-list.tsx`: `SearchList` and `SearchSuggestions`,
two components over one private row, built on the
[`Popover`](popovers.md) module at `size="trigger"` with `anchor`. Both
sit in a [`Field`](fields.md#field) and throw without one. A third,
[`SearchListDetail`](#searchlistdetail), uses the same row in a list that
is always open, with a detail beside it. The field's
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
 ├── One option from a list they search, where each option has its own
 │     choices to make before anything applies (who a share is for, and
 │     how much) → SearchListDetail
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
- `tag`: a neutral [`Tag`](labels.md#tag) beside the label, for the one
  option that stands apart ("On Caishen" on the partner). Like any tag, it
  marks an exception; if most options would carry one, drop it.

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

## SearchListDetail

A search over a list that never closes, and beside it a detail for the
row under the highlight: who on the left, what for them on the right. It
fills a [`Popover`](popovers.md) at `size="wide"` and takes `label` itself
instead of sitting in a `Field`, because the field's hint and error would
sit under both panes.

`label`, `options` (as above, without `group`), `value` (checked in the
list), `defaultHighlight`, `createNoun`, `placeholder`, `maxLength`,
`inputRef`, `empty`, `detail`. Nothing else exists.

- `detail(highlight)` returns `{ label, title, children }`: the detail's
  accessible name, the title over it, and its choices. `highlight` is
  `{ kind: "option", option }`, `{ kind: "create", name }` for the New
  row, or `null`, when the title shows faint and the choices should be
  disabled.
- Choices are `DetailOption` (`title`, `detail`, `pressed`, `disabled`,
  `onClick`), a list row as a button with the check column; `pressed`
  marks the choice as it stands. `DetailSeparator` sets apart a choice that
  undoes the others. A field the detail needs (an amount) goes between
  them with 8px padding, which with the detail's 4px is a form's 12px.
- `createNoun`: a New row pinned at the top for a typed name no option
  has ("New person “Priya”"). It only highlights; the detail decides what
  taking it does, so nothing is made until a choice applies.
- `defaultHighlight`: who the detail shows at open. Leave it out when no
  option is a safe guess; nothing is highlighted and the detail waits.

What it does, with nothing for the screen to wire:

- Focus starts in the search, which is empty. The list is the whole list
  until something is typed; typing filters by label, and the highlight
  takes the first match, or New once nothing matches.
- ArrowDown and ArrowUp move the highlight; the pointer moves it too. A
  pointer heading right, toward the detail, waits 140ms (scale.md,
  Motion) before a row it crosses takes the highlight, and reaching the
  detail cancels the wait, so the detail doesn't change under it.
- Enter, a click on a row, or ArrowRight with the caret at the end of the
  text crosses into the detail, at its pressed choice or its first. There
  ArrowDown and ArrowUp move between choices, and ArrowLeft or a letter
  comes back to the search.
- Escape clears the search, then closes the popover. The search carries
  `data-holds-escape` while it has text (popovers.md).
- Its height at open is the least it keeps, so a search that narrows the
  list never pulls the popover's edge in ([rows.md](rows.md#nothing-moves)).
  The list scrolls inside a 420px cap.
- Under 520px wide, as on a phone, the detail stacks under the list. The
  people pane is capped at the smaller of 240px and 35% of the viewport
  height, leaving room to reach the amount choices. Rows
  and choices are 44px on touch, and the search's 16px text keeps the page
  from zooming.

```tsx
// Correct (share-field.tsx)
<SearchListDetail
  label="Who is this for"
  placeholder="Find or add a person"
  createNoun="person"
  value={share?.amount ? share.accountId : ""}
  defaultHighlight={initial}
  options={people.map((item) => ({
    value: item.id,
    label: item.name,
    tag: isLinked(item) ? "On Caishen" : undefined,
    amount: item.balance,
  }))}
  detail={(highlight) => ({
    label: name ? `How much is for ${name}` : "How much",
    title: name ?? "Choose who it’s for",
    children: <DetailOption title="Half" detail={money(half)} … />,
  })}
/>

// Incorrect: the prototype's hand-built rail. Its own well, rows, keys and
// Escape, borrowed from field.module.css and search-list.module.css
<div className={field.well} data-well="">
  <input role="combobox" aria-expanded="true" className={field.input} … />
</div>
<div role="listbox">{people.map((item) => <div className={list.option} … />)}</div>
```

**Decided** (share picker, from the prototype at `/playground/share-picker`,
November 2026). The share picker is two panes: people on the left, how much
for the highlighted one on the right, applied at once. The left pane is one
flat list, the partner first with an "On Caishen" tag and balances beside
names; no group headings or divider, and no footer: a new person comes
only from a typed name, and Just mine is the right pane's last choice,
shown only when the line has a share to clear, including bulk selections.
The search placeholder is the prompt; there is no extra header. The right
pane is the full name and the choices; no remembered-share hint, no balance
line under the name and no note on who sees
the share. Rejected: Baseline, the single column it replaces (a person in a
search field, then the amounts under it), which costs a step for every
share; and Inline, people that open in place in the list to show their
amounts, which moves the rows under the open person.
