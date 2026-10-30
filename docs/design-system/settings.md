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
- `error`: an action that failed (photo upload, resend, connecting Google).
  It shows under the description and is announced (`role="alert"`). An error
  about what someone typed belongs to its field, not the row.
- `below`: what opens under the row, like the "Change email" and "Add
  password" forms, or the partner invitation and its composer. It spans the
  card's full width under a thin line. Never put it in `description`, where
  its width would depend on the help text.

Only the control acts. Clicking the label or description does nothing,
so a row is never a `<label>`, because a click on help text that flips a
setting is a surprise.

How the control gets its name:

```text
What is the control?
 ├── Switch → nothing to add. The row names it with its label
 │   (aria-labelledby) and describes it with its description.
 ├── A native <select> or <input> → pass htmlFor with the control's id.
 │   Temporary: goes away in #223's second phase, when Select and
 │   TextInput read the row the way Switch does.
 └── Button or SegmentedControl → the label is plain text and the
     control keeps its own name (its text, or aria-label).
```

```tsx
// Correct: the row names the switch
<SettingRow
  label="Send the daily review"
  description="Your budget and bank updates keep working when this is off."
>
  <Switch checked={value.emailEnabled} onCheckedChange={…} />
</SettingRow>

// Incorrect: the name is said twice, and the whole row becomes a click target
<label>
  <SettingRow label="Send the daily review">
    <Switch aria-label="Send the daily review" … />
  </SettingRow>
</label>
```

## SettingsDivider

A full-bleed line between rows in one card. Place it by hand between rows,
because a card also holds things that aren't rows: the next-email footer
in `entry/profile-preferences.tsx`, and the composer under the invitation
in `settings/partner.tsx`. Never draw a border on a row to stand in for one.
Never put a divider between sections; sections are separate cards.
