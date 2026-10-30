# Menus

Read [surfaces.md](surfaces.md) first: it covers `SurfaceProvider` and the motion rule every menu follows.

## Menu

`src/components/ui/menu.tsx`. Use for a list of actions; use a `Popover`
for a form. A menu is always non-modal: the page behind stays live, and a
click outside closes the menu and lands. It is as wide as its trigger and
never narrower than 248px; hung from an `anchor`, it keeps 248px.

```tsx
<Menu
  label={budgetName}
  motion="occasional"
  trigger={<button type="button">…</button>}
>
  <MenuItem
    icon={<SettingsIcon size={14} aria-hidden />}
    title="Settings"
    href={settingsHref}
    onNavigate={onNavigate}
  />
  <MenuSeparator />
  <MenuItem
    icon={<LogOutIcon size={14} aria-hidden />}
    title="Log out"
    onSelect={signOut}
  />
</Menu>
```

- `Menu`: `label` (required), `trigger`, optional `anchor` to hang from a
  frame instead, `open` and `onOpenChange`, `side`, `align`, `motion`, and
  `error`, a refused action's reason shown as an alert line below the items.
- `MenuItem`: `title`, `icon`, `detail` (a line under the title),
  `disabled`, and either `onSelect` or `href`.
  - `onSelect(event)`: `event.preventDefault()` keeps the menu open, for an
    action that was refused and says why through `error`.
  - `href` with `onNavigate(href)`: a plain click goes to `onNavigate` for
    in-app routing; a modified click opens the link the browser's way.
- `MenuRadioGroup` (`value`, `onValueChange`) and `MenuRadioItem`
  (`value`, `title`, `tag`, `detail`): a choose-one list; the current choice
  carries a check. `tag` is a short neutral label beside the title ("Most
  common"); `detail` is one line or several, the first more prominent.
- `MenuSub` (`title`, `label`, `disabled`): an item that opens its own list
  beside the menu. Submenus are always instant.
- `MenuSeparator`.
