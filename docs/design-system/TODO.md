# Design system to-do

UI in the app shell prototype (`src/components/prototype/app-shell/`) that
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
      a `Tabs` variant or take the pill look (`app-shell-prototype.tsx`)
- [ ] Month label button in the header (`app-shell-prototype.tsx`)
- [ ] `Select`: the custom date range's native selects (`reflect/filters.tsx`)
- [ ] `Popover` surface: the Reflect filters, slice, and move-money popovers
      style their own (`reflect/reflect.module.css`, `move-money.module.css`)
- [ ] Text field and combobox: the move-money amount input and its searchable
      destination list, including their invalid state and field error
      (`move-money.tsx`)
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
      `Meter`, `Figure`) move out of the prototype; type `Figure` and `Meter`
      tone props as `Funding` instead of `string`

## Tokens

- [ ] Add a field-error token: move-money's invalid inputs and error text use
      `--danger-line` and `--danger-text`, which are meant for destructive
      confirms (`move-money.module.css`, `[data-invalid]`, `.error`)
- [ ] Add an `--overlay` token for the scrims behind the peeking sidebar and
      the narrow drawer (`shell.module.css`, `.scrim`, `.peekScrim`)
- [ ] Budget avatar's raw orange and white (`shell.module.css`, `.avatar`)
- [ ] Chart series colors come from Dither Kit's RGB palette in TypeScript;
      map them to tokens that follow the theme (`reflect/chart-utils.ts`)
- [ ] Replace hand-written `6px` radii with `--radius-row` (about 12 rules)
- [ ] Dimmed chart slice labels use `opacity: 0.4`; use a text token
      (`reflect/reflect.module.css`, `.sliceLabel[data-dim]`)

## Gaps found by testing the docs with a fresh agent

- [ ] Move the focus ring and the button font reset out of `.root` in
      `shell.module.css` into a global base stylesheet, so a screen outside the
      shell doesn't redeclare them
- [ ] Add a `Dialog` primitive (confirm dialogs use Radix `AlertDialog`
      directly today)
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
