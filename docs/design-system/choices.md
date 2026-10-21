# Choices

```
What is the user choosing?
 ├── Whether a setting is on, taking effect the moment it changes → Switch
 ├── Which items to include or act on → Checkbox
 ├── Which of 2–4 views of the same content → SegmentedControl
 ├── Which of 2+ sections of different content → Tabs
 └── One of 5+ options → a select (not in the system yet; see DESIGN.md)
```

None of these take variants or sizes.

## Checkbox

`src/components/ui/checkbox.tsx`, built on Radix Checkbox. Use for picking
items: rows to act on together, categories in a filter. A setting that takes
effect immediately is a `Switch`.

`checked` is `true`, `false`, or `"indeterminate"` for a parent whose
children are partly checked. `onCheckedChange` receives the same values.

Name every checkbox. Next to visible text, wrap both in a `<label>`, which
also makes the text clickable. With no visible text, as in a table row, pass
`aria-label`.

```tsx
// Correct: label wraps the checkbox and its text
<label className={styles.check}>
  <Checkbox
    checked={mixed ? "indeterminate" : checked}
    onCheckedChange={(value) => onChange(value === true)}
  />
  <span>{label}</span>
</label>

// Incorrect: a native input, styled by hand, with no name
<input type="checkbox" checked={checked} className={styles.box} />
```

## Switch

`src/components/ui/switch.tsx`, built on Radix Switch. Use for a setting that
takes effect the moment it flips, like which sections the daily review email
includes. Settings never wait for a Save button: a switch that only applies
after Save tells the user something happened when it didn't.

`checked` is `true` or `false`; `onCheckedChange` receives the new value.
Name it like a Checkbox: wrap it in a `<label>` with its text, or pass
`aria-label`. In a settings list the text goes first and the switch sits at
the row's end.

```tsx
// Correct
<label className={styles.check}>
  <span className={styles.checkText}>
    <span className={styles.checkLabel}>{section.label}</span>
    <span className={styles.checkHint}>{section.hint}</span>
  </span>
  <Switch
    checked={sections.includes(section.id)}
    onCheckedChange={(on) => onToggle(section.id, on)}
  />
</label>

// Incorrect: checkboxes for a setting, held until Save
<Checkbox checked={draft.includes(id)} onCheckedChange={setDraft} />
<Button variant="primary" onClick={save}>Save</Button>
```

## SegmentedControl

`src/components/ui/segmented-control.tsx`, built on Radix RadioGroup. Use
when every option shows the same content arranged differently: group the
report by Categories or Groups. When each option shows different content,
use `Tabs`.

Always controlled with `value` and `onValueChange`, and always named with
`aria-label`, because there is no visible label.

```tsx
// Correct
<SegmentedControl
  aria-label="Group by"
  value={value}
  onValueChange={(next) => onChange(next as Grouping)}
>
  <SegmentedControlItem value="categories">Categories</SegmentedControlItem>
  <SegmentedControlItem value="groups">Groups</SegmentedControlItem>
</SegmentedControl>

// Incorrect: Tabs for options that only rearrange the same data
<Tabs value={grouping}>
  <TabsList>
    <TabsTrigger value="categories">Categories</TabsTrigger>
  </TabsList>
</Tabs>
```

`fill` spans the control across its container, its segments sharing the
width. Use it
only where the choice leads a form in a narrow panel, like a target's
schedule in the inspector, so every option stays visible as the panel
narrows. Everywhere else it takes its natural width.

```tsx
<SegmentedControl fill aria-label="Schedule" value={schedule} onValueChange={set}>
  <SegmentedControlItem value="weekly">Weekly</SegmentedControlItem>
  <SegmentedControlItem value="monthly">Monthly</SegmentedControlItem>
</SegmentedControl>
```

## Tabs

`src/components/ui/tabs.tsx`, built on Radix Tabs: `Tabs`, `TabsList`,
`TabsTrigger`, `TabsContent`. Use to split a card's details into sections a
user reads one at a time. Arrow keys move between tabs.

Give `TabsList` an `aria-label` naming the whole set. Every `value` is a
stable id, never the visible label, because labels carry counts that change
("To review 3"). Use `defaultValue` unless something else must know which tab
is open.

In the inspector, tabs sit inside a `Card`:

```tsx
// Correct
<Card>
  <Tabs defaultValue="review">
    <TabsList aria-label="Account details">
      <TabsTrigger value="review">To review {review.length}</TabsTrigger>
      <TabsTrigger value="balances">Balances</TabsTrigger>
    </TabsList>
    <TabsContent value="review">…</TabsContent>
    <TabsContent value="balances">…</TabsContent>
  </Tabs>
</Card>

// Incorrect: the label as the value, and a config array instead of parts
<Tabs
  tabs={[{ label: `To review ${review.length}`, content: <ReviewList /> }]}
/>
```

The Spending Breakdown / Trends switcher in the page header is not this
component; header tabs aren't in the system yet.
