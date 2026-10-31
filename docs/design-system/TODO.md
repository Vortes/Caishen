# Design system to-do

UI in the app shell (`src/components/app-shell/`) that
doesn't follow the design system yet. Check items off as they land.

## Missing primitives

- [ ] `Row`: plan category and group rows, register rows, loan rows, Reflect
      entry, list, and slice rows (`views.tsx`, `reflect/*.tsx`)
- [ ] `NavItem`: sidebar items, section headings, budget switcher, Settings
      (`sidebar.tsx`)
- [ ] Menu row: date presets (`reflect/filters.tsx`), auto-assign items
      (`inspector.tsx`), the move-money destination options (`move-money.tsx`)
- [ ] Breadcrumbs (`reflect/reflect-view.tsx`)
- [ ] Header tabs: Spending Breakdown / Trends, and decide whether they become
      a `Tabs` variant or take the pill look (`app-shell.tsx`)
- [ ] Month label button in the header (`app-shell.tsx`)
- [x] `Select`: every native select, including the custom date range's
      (`src/components/ui/select.tsx`, [selects.md](selects.md))
- [x] `Popover` surface: `Popover`, `Menu`, `Dialog` and `ConfirmDialog`
      (`src/components/ui/`, [surfaces.md](surfaces.md))
- [x] Text field: `Field`, `TextInput`, `AmountInput`, `FormError`,
      `FormFooter` (`src/components/ui/`, [fields.md](fields.md),
      [amounts.md](amounts.md))
- [ ] Combobox and date input: a shared search box and date field. Until
      then these controls draw their own well; delete each rule once its
      controls move:
  - `transaction-entry.module.css` `.well`, `.input`, `.chevron`: the
    register editor's date (`transaction-date.tsx`); the payee, category and
    account comboboxes (`ChoiceField`, `PayeeField` in
    `transaction-fields.tsx`)
  - `move-money.module.css` `.search`: the move-money destination
    (`move-money.tsx`) and the new category or group name
    (`add-category.tsx`)
  - `move-money.module.css` `.amountInput`: the "Who owes it" inputs
    (`share-field.tsx`, `transaction-category-field.tsx`), the payee
    (`partner-record.tsx`), and the reimbursement date
    (`reimbursements-register.tsx`)
  - `move-money.module.css` `.field`, `.error`: the hand-built field around
    those controls and `ChoiceField` (`partner-record.tsx`,
    `reimbursements-register.tsx`), and error text under them
    (`share-field.tsx`, `transaction-category-field.tsx`,
    `partner-register.tsx`). The form errors drawn with `.error` and
    `role="alert"` (`partner-record.tsx`, `reimbursements-register.tsx`)
    become `FormError`
- [ ] Text inputs still drawn by hand that `TextInput` can take now:
      `entry.module.css` `.input` (`settings/partner.tsx`,
      `entry/account-settings.tsx`, `entry/guided-onboarding.tsx`,
      `entry/onboarding-categories.tsx`), `account-entry.module.css`
      `.field > input`, `banks.module.css` `.field input`, and
      `shell.module.css` `.settingInput` (`settings/profile.tsx`)
- [x] Toast: the undo toast after a move (`src/components/ui/toast.tsx`,
      [toasts.md](toasts.md))
- [x] Skeleton: the app shell's loading screen
      (`src/components/ui/skeleton.tsx`, [loading.md](loading.md))
- [ ] Busy status message: Reflect's spinning `Notice`
      (`reflect/reflect-view.tsx`) has no primitive
- [ ] Filter chip: the plan's focused views are `Button size="sm"` toggles,
      which have no tone, so Overspent lost YNAB's red or yellow fill and only
      its count takes the funding color; decide whether chips become a
      primitive with a funding tone (`plan-views.tsx`)
- [ ] The Available pill as a button: plan rows lay a bare `<button>` over the
      pill to open move money (`move-money.module.css`, `.pillButton`); decide
      whether funding pills get a pressable form
- [ ] Funding components (`AvailablePill`, `FundingBar`, `FundingRing`,
      `Meter`, `Figure`) move into the shared UI library; type `Figure` and `Meter`
      tone props as `Funding` instead of `string`

## Tokens

- [x] Add a field-error token: `--field-error` and `--field-error-line`,
      through `Field` ([tokens.md](tokens.md))
- [x] Add an `--overlay` token for the scrims behind the peeking sidebar and
      the narrow drawer (`shell.module.css`, `.scrim`, `.peekScrim`)
- [ ] Budget avatar's raw orange and white (`shell.module.css`, `.avatar`)
- [ ] Chart series colors come from Dither Kit's RGB palette in TypeScript;
      map them to tokens that follow the theme (`reflect/chart-utils.ts`)
- [ ] Replace hand-written `6px` radii with `--radius-row` (about 12 rules)
- [ ] Dimmed chart slice labels use `opacity: 0.4`; use a text token
      (`reflect/reflect.module.css`, `.sliceLabel[data-dim]`)
- [ ] `--surface-group` used for things that aren't group or date headers:
      the settings zone hint (`entry/settings.module.css`, `.zoneHint`), the
      disabled amount well (`transaction-entry.module.css`,
      `.well[data-disabled]`), and the reconcile icon
      (`reconcile.module.css`, `.icon`)

## Gaps found by testing the docs with a fresh agent

- [ ] Move the focus ring and the button font reset out of `.root` in
      `shell.module.css` into a global base stylesheet, so a screen outside the
      shell doesn't redeclare them
- [x] Add a `Dialog` primitive: `Dialog` and `ConfirmDialog`
      (`src/components/ui/dialog.tsx`)
- [ ] The account Sync property's attention tag reads "Reconnect", an action;
      rename it to a state ("Signed out" or similar) and decide whether a
      Reconnect button sits beside it (`inspector.tsx`)

## Enforcement

- [ ] Lint rule: no raw `<button>`, `<input>`, or `<select>` outside
      `src/components/ui/`, once the primitives above exist
- [ ] Stylelint rule: no hex, `oklch()`, `rgb()`, or primitive tokens outside
      `src/styles/tokens.css`

## Restored or dropped behavior

- [ ] Filter triggers lost their highlight when a filter narrows the report;
      bring it back as a documented `pressed` state on `Button`, or drop it
- [ ] Ready to Assign card's tint was dead CSS and was removed; decide whether
      it should be tinted
