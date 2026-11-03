# Dates

`src/components/ui/date-field.tsx` (`DateField`) for every date a person
enters, with the calendar from `calendar.tsx` on the
[`Popover`](popovers.md) module. It sits in a [`Field`](fields.md#field)
and throws without one. Never `<input type="date">`: each browser draws
its own picker, in its own format. A date range picked from presets, such
as Reflect's, is a [`Select`](selects.md).

## DateField

`value` and `onChange(value)`, `today`, `min`, `max`, `name`, `disabled`,
`readOnly`, `inputRef`. For a form that drives the calendar itself:
`open` and `onOpenChange`, `handle`, `onPicked`, `onAdvance`. Nothing else
exists.

- Values cross as `YYYY-MM-DD`. Text that isn't a date yet crosses as
  typed, so on submit the screen checks the value is a date, and an empty
  field is the screen's to judge.
- `today` is required: the budget's today, from its timezone
  (`today(timezone)`), never the browser's. A typed "10/3" takes its year,
  and the calendar marks it.
- `min` and `max` bound the days the calendar offers; days outside are
  shown but can't be picked. They don't refuse typed text, so a screen
  with a limit checks it on submit too. Set `max` to today where activity
  can't be in the future (the register, a repayment, "Balance as of").
- `handle.focusCalendar()` moves focus into the calendar, now or once it
  opens: the register opens it after the account is picked.
- `onPicked` runs after a day is picked; `onAdvance` runs on Tab out of
  the calendar's last stop. Without them, focus returns to the field, and
  Tab carries on from it.

What it does, with nothing for the screen to wire:

- Shows `MM/DD/YYYY`. While typing, only a complete date is taken. On
  leaving, a short date takes today's year ("10/3" → 10/03/2026) and a
  two-digit year becomes 20xx ("10/3/25" → 10/03/2025).
- Text it can't read stays as typed, and its `Field` shows "Enter a date,
  such as 10/30/2026." with today's date. The message goes once the field
  holds a date or nothing. A screen's own date error goes in the `Field`'s
  `error` and wins over it.
- A click or ArrowDown opens the calendar. Escape closes only the calendar.
  Enter with it open takes the typed date and never sends the form.
- On a phone a calendar button replaces the icon, so the calendar opens
  without the software keyboard; a picked day returns focus to that
  button. The well is 44px with 16px text, as every field is.

```tsx
// Correct (record-repayment.tsx)
<Field label="Date">
  <DateField
    value={date}
    // A repayment is recorded once it arrived.
    max={today(timezone)}
    today={today(timezone)}
    onChange={setDate}
  />
</Field>

// Incorrect: the browser's date picker in a borrowed well, labelled by hand
<div className={moveStyles.field}>
  <label htmlFor={`${id}-date`}>Date</label>
  <div className={moveStyles.amountInput}>
    <input id={`${id}-date`} type="date" value={date} max={today(timezone)} onChange={…} />
  </div>
</div>
```

A screen's own rule about the date goes in the field's `error`, as the
target editor's due date does:

```tsx
// Correct (target-editor.tsx)
<Field
  label={payoff ? "Pay off by" : custom ? "Due on" : "By"}
  error={errorFor("dueDate")}
  hint={payoffHint}
>
  <DateField
    value={draft.dueDate}
    min={`${earliest}-01`}
    today={today}
    inputRef={register("dueDate")}
    onChange={(dueDate) => change({ dueDate })}
  />
</Field>
```
