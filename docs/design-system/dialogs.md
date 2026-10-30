# Dialogs

Read [surfaces.md](surfaces.md) first: it covers `SurfaceProvider` and surface motion.

## Dialog

`src/components/ui/dialog.tsx`. Use for a task that takes over the screen
for a moment. A dialog is centered over a scrim (`--overlay`, z-index 80)
and sits above every popover (z-index 81). Closing returns focus to what
had it when the dialog opened.

- `Dialog`: `label` (required; the content draws its own heading), `open`,
  `onOpenChange`, `size` (`default`, `--size-dialog`, 400px; or `wide`,
  `--size-dialog-wide`, 480px, with content that pins its own header and
  footer and scrolls only its body), `continued` (lands on a scrim already
  up, as after Plaid's window, so it doesn't fade in twice), and
  `autoFocus` (off focuses the dialog itself, so no control opens wearing a
  focus ring).
- `DialogHeader`: `title` and `description`, the heading a `Dialog` draws
  for itself in `ConfirmDialog`'s style. Use it rather than restyling a
  title and description.
- `DialogScrim`: the scrim alone, for a window drawn by someone else with no
  backdrop of its own, like Plaid's. A `Dialog` with `continued` lands on it.

## ConfirmDialog

`src/components/ui/dialog.tsx`. Use for a question with two answers before
an action that can't be undone. Cancel takes focus on open and Escape
answers Cancel; a click outside does nothing.

```tsx
<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  trigger={<Button>Disconnect…</Button>}
  title={`Disconnect from ${name}?`}
  description="You’ll each keep a budget of your own."
  cancel="Cancel"
  confirm={pending ? "Disconnecting…" : "Disconnect"}
  tone="danger"
  onConfirm={() => disconnect.mutate()}
  pending={pending}
  error={error?.message}
/>
```

- `trigger` is optional. With it, focus returns to the trigger. Without it,
  as when a Cancel only sometimes asks first, the site opens it through
  `open` and focus returns to what had it when it opened.
- `tone` is `danger` or `primary`, the confirm button's variant.
- `onConfirm` leaves the dialog open; the site closes it once the work is
  done.
- `pending` disables both buttons and nothing closes the dialog.
- `error` shows why the work failed, above the buttons.
