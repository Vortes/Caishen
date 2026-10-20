# Toasts

## Toast

`src/components/ui/toast.tsx`: `ToastRegion` and `Toast`. Use a toast to
confirm something that just happened away from where the user is looking
("Moved $50.00 from Gifts to Rent", "Action undone."), or to say a change
failed. A result the user can already see in place, like a field's error or
a row that updated, needs no toast.

```
What happened?
 ├── A change saved or was undone → Toast (neutral), gone after 5s
 ├── A saved change the user may want back → Toast (neutral) with an
 │    Undo action, only while the history can still undo it
 ├── A change failed, or the screen can't save until the user acts
 │    → Toast tone="attention", stays until dismissed or fixed
 └── A form field is wrong → an error next to the field, not a toast
```

Tones: `neutral`, `attention`. Nothing else exists.

- `neutral` is the default and dismisses itself after `duration`
  (5000ms unless set).
- `attention` means something failed and the user has to act, like Tag's
  attention tone. It shows an alert icon, is announced as an alert, and
  stays until `onDismiss` runs; pass `onDismiss` to show a Dismiss button,
  or leave it out for a toast that stays as long as its cause (a budget that
  couldn't refresh).

`action` is at most one `Button size="sm"`, secondary. A toast's action is
a shortcut to something the user can also do another way (Undo is also
⌘Z), never the only way. If the action can't run right now, disable it; if
it can no longer run at all, drop it, so a toast never offers something
that won't happen.

The timer pauses while the pointer is over the toast or focus is in it.
Give each toast a new `key` to show it fresh and restart its timer.

Mount `ToastRegion` once per screen, inside the themed root, and keep it
mounted even when it's empty: screen readers only announce what's added to
a region that was already there. It stacks toasts in the bottom-right
corner, newest last.

```tsx
// Correct: one region, always mounted; a keyed toast with one action
<ToastRegion>
  {notice && (
    <Toast
      key={notice.id}
      onDismiss={() => setNotice(null)}
      action={
        canUndo && (
          <Button size="sm" onClick={undo}>
            Undo
          </Button>
        )
      }
    >
      {notice.message}
    </Toast>
  )}
</ToastRegion>;

// Incorrect: a region mounted with its toast, a primary action, and a
// toast for an error that belongs next to its field
{
  notice && (
    <ToastRegion>
      <Toast action={<Button variant="primary">Undo</Button>}>
        Enter an amount above zero.
      </Toast>
    </ToastRegion>
  );
}
```
