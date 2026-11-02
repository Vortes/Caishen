# Spacing

Spacing is picked by role, never by eye. Two tiers:

- **Layout** uses the tokens in `src/styles/tokens.css`: where panels, cards
  and rows sit.
- **Inside a component** (a popover form, a row's contents, a list) uses the
  fixed values in the role table below, written as raw pixels. There are no
  tokens for them yet, so the table is the rule.

A value that isn't in either table is drift. If a layout needs one, add the
role here first.

## Layout tokens

| Token            | Value | Use                                               |
| ---------------- | ----- | ------------------------------------------------- |
| `--space-gutter` | 8px   | Between the window edge and panels                |
| `--space-inset`  | 8px   | A panel's inner padding                           |
| `--space-stack`  | 10px  | Between stacked cards                             |
| `--space-row-x`  | 14px  | A panel row's horizontal padding (plan, register) |
| `--space-card`   | 16px  | A card's padding                                  |

## Inside a component

| Role                                                     | Value |
| -------------------------------------------------------- | ----- |
| A title and its secondary line, a figure and its label   | 2px   |
| Around the rows of a list inside a popover               | 4px   |
| An icon and its text; a label and its control            | 6px   |
| A control and the hint or error under it                 | 6px   |
| A row's horizontal padding inside a menu or popover list | 8px   |
| Between buttons in a footer                              | 6px   |
| Items in a row (a checkbox, a name, a tag)               | 8px   |
| A popover form's inset, on every side                    | 12px  |
| Between the fields and sections of a popover form        | 12px  |
| Between columns of figures                               | 16px  |
| Between unrelated groups in a detail panel               | 24px  |

The popover surface adds no padding (see [popovers.md](popovers.md)), so the
content's root sets the 12px inset itself. A list that runs edge to edge
inside a popover takes 4px instead, so its rows' hover fills sit 4px from
the surface's border. The two never stack: a form that contains a list keeps
its 12px inset and the list drops its own.

```text
What am I spacing?
 ├── Panels, cards, or a panel row's horizontal padding (plan, register)
 │     → a layout token
 ├── A row's horizontal padding inside a menu or popover list → 8px
 ├── The edge of a popover's content
 │    ├── A form → 12px
 │    └── A list of rows → 4px
 ├── Two fields, or a field and the footer → 12px
 ├── A label and its input, an input and its hint, an icon and its text,
 │   two footer buttons → 6px
 ├── Things side by side in one row → 8px
 └── A line and the smaller line under it → 2px
```

```css
/* Correct (reconcile.module.css) */
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* Incorrect: off-table values, and a card token on a popover form */
.form {
  gap: 10px;
  padding: var(--space-card);
}
.footer {
  gap: 8px;
}
```

Use `gap` on a flex or grid parent for space between siblings, never
`margin` on the children: a margin on the first or last child pushes against
the parent's padding and the inset stops matching the table. `margin` is for
cancelling a parent's spacing in one place, with a comment saying why.

Some existing screens predate this table (the Add account form uses
`--space-card` and `--space-row-x`, the move-money header 10px). Don't copy
them; follow the table, and leave them until a change touches that screen.
