# Settings

`src/components/ui/settings.tsx`. Every settings screen is built from four
parts: `SettingsPage`, `SettingsSection`, `SettingRow` and
`SettingsDivider`. Screens never import the module's stylesheet or
`shell.module.css` for settings; the classes are private.

## SettingsPage

The centered column, 680px wide, with 40px between sections. One per
screen, wrapping every section (`settings/profile.tsx`,
`settings/partner.tsx`, `app-shell/appearance.tsx`).

## SettingsSection

One group of related settings: a heading over a card of rows. It draws its
own `Card`; pass only the card's contents, never a `Card`.

Name it with exactly one of `heading` or `aria-label`. The type rejects
both or neither.

- `heading`: when the section needs a visible title (Account, Daily review
  email, Mode).
- `aria-label`: when the page title already says what it is, like the one
  card on Partner, or the Profile and Timezone cards.

The other props, each with its one call site:

- `intro`: one sentence under the heading saying what the section is for.
- `action`: sits at the heading's end. The theme filter on Appearance.
- `card={false}`: content that lays itself out, so there is no card. The theme
  grid.
- `after`: follows the card inside the section. The daily email preview.

```tsx
// Correct
<SettingsSection heading="Account">
  <EmailRow user={user} />
  <SettingsDivider />
  <PasswordRow user={user} />
</SettingsSection>

// Incorrect: the section already draws the card, and the heading is hand-built
<SettingsSection aria-label="Account">
  <h2>Account</h2>
  <Card>…</Card>
</SettingsSection>
```

## SettingRow

One setting: `label`, an optional `description`, and the control as
children, at the row's end. Several controls sit side by side 6px apart.
A row with no children is a statement, like "Connected with Sam".

- `lead`: drawn before the label. Only the profile picture's avatar.
- `error`: an action that failed (photo upload, disconnecting Google). It
  shows under the description and is announced (`role="alert"`).
- `fieldError`: what's wrong with what was typed into the row's
  `TextInput`, like a budget name the budget refuses. It looks like a
  `Field`'s error, describes the control, marks it invalid, and is never
  announced ([fields.md](fields.md)). A failed save of a form under the row
  is that form's `FormError`, not either prop.
- `below`: what opens under the row, like the "Change email" and "Add
  password" forms, or the partner invitation and its composer. It spans the
  card's full width under a thin line. Never put it in `description`, where
  its width would depend on the help text.

Only the control acts. Clicking the label or description does nothing:
the label is plain text, never a `<label>`, because a click on help text
that flips a switch or opens a list is a surprise. The row names the
control with `aria-labelledby` instead.

The row does for its control what a `Field` does: it gives `TextInput`,
`Select` and `Switch` their id, name, description and invalid state. Never
wrap a control in a `Field` inside a row; the name would be said twice.

```text
What is the control?
 ├── TextInput, Select or Switch → nothing to add. The row's label names
 │   it, and its description and fieldError describe it.
 └── Button or SegmentedControl → the label is plain text and the
     control keeps its own name (its text, or aria-label).
```

A row leaves its controls their own size, and a well fills its container,
so put a `TextInput` or `Select` in a div the screen sizes (`.rowWell` in
`entry/settings.module.css`, 12rem). A form under the row (`below`) uses
`Field`s as any form does.

```tsx
// Correct: the row names the select and the switch
<SettingRow label="Send at" description="New York time, your budget’s timezone.">
  <div className={styles.rowWell}>
    <Select value={hour} onChange={…} options={hours} />
  </div>
</SettingRow>
<SettingRow
  label="Send the daily review"
  description="Your budget and bank updates keep working when this is off."
>
  <Switch checked={value.emailEnabled} onCheckedChange={…} />
</SettingRow>

// Incorrect: the name is said twice, and a click on the label opens the list
<SettingRow label="Send at">
  <Field label="Send at" labelHidden>
    <Select … />
  </Field>
</SettingRow>
```

## SettingsDivider

A full-bleed line between rows in one card. Place it by hand between rows,
because a card also holds things that aren't rows: the next-email footer
in `entry/profile-preferences.tsx`, and the composer under the invitation
in `settings/partner.tsx`. Never draw a border on a row to stand in for one.
Never put a divider between sections; sections are separate cards.
