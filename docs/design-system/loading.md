# Loading

## Which loading state

```
What is loading?
 ├── The app shell's first load, before the budget arrives
 │    → ShellSkeleton (prototype/app-shell/shell-skeleton.tsx). Every
 │      screen's data comes with the budget, so no screen needs its own
 ├── A screen or panel whose data loads separately from the budget,
 │    with nothing on it yet and a known layout
 │    → Skeleton: its own frame, with bones where its data goes
 ├── New data replacing data already on screen, like another month
 │    → keep the old data up and show the progress line along the
 │      panel header's bottom edge (.monthLoading in shell.module.css)
 └── One panel computing a result whose layout depends on the result,
      like Reflect's report
      → a status message with a spinning 18px LoaderCircle
        (Notice with busy in reflect/reflect-view.tsx)
```

The progress line and the status message have no primitive yet; copy the
prototype's pattern. Never show a spinner over a skeleton, and never replace
data that's already on screen with bones: a screen that empties itself to
load looks like it lost the data.

## Skeleton

`src/components/ui/skeleton.tsx`. One bone, for one piece of data that
hasn't loaded. Build the loading screen from the same layout as the loaded
one, with the real components (`Card`, `Property`, the shell's row classes),
and swap only the data for bones. When the data arrives nothing moves, so
the screen reads as filling in instead of reloading.

Shapes: `text`, `figure`, `avatar`, `pill`, `button`, `button-sm`,
`funding-bar`. Nothing else exists. `text` is the default.

```
What replaces the bone?
 ├── A card's headline amount (Figure, Ready to Assign) → figure
 ├── A Tag or a funding pill (Available) → pill
 ├── A Button or IconButton → button; a Button size="sm" → button-sm
 ├── The funding bar under a category → funding-bar
 ├── The budget's avatar → avatar
 └── Any other text or amount → text
```

### What gets a bone

Only data. Anything that reads the same in every budget shows as itself:
navigation labels, the screen title, the month, column headers, property
labels, section headings like Cash and Credit. A bone where a known label
goes makes the screen look emptier than it is and makes the label pop in.

A label that changes with the data is data: Ready to Assign reads
"Overassigned" when the amount is negative, and a register's day headers
("Today", "Oct 14") are dates, so each is a bone.

An icon that depends on the data (a transaction's status, a warning dot)
gets no bone and no placeholder. If the loaded row always reserves the
icon's slot, keep the slot empty at the icon's size from
[scale.md](scale.md) so the text after it doesn't move; otherwise leave it
out.

### How many

Fill the first screen and stop: a list gets 10 to 12 rows, split into 2 to
4 groups if the loaded list is grouped. One row reads as a one-item list;
more than a window's worth is work nobody sees.

### Width

Pass `width` in pixels, close to the content it stands in for. Vary widths
down a list (`[96, 48, 64, 88]`); bones of one width read as stripes, not
text. Leave `width` out only for content that fills its container, like a
funding bar or a card-wide button.

### Layout and theme

A skeleton opens in the theme and panel layout the screen will open in. The
app shell reads them with `useSavedSettings()` from `settings.ts`. A dark
skeleton that turns light, or a sidebar that closes when the data lands, is
the jump the skeleton exists to prevent.

The shell's pages are prerendered at build, so the server's HTML can be
days old. Anything derived from the clock, like the current month, renders
as a `text` bone on the server and as itself from the first client render
(`ShellSkeleton`'s month), or the HTML shows the month the site was built.

### Accessibility

Bones are `aria-hidden`. Each loading region announces itself once: its
root sets `aria-busy` and holds one visually hidden `role="status"` naming
what's opening ("Opening your budget…"). That region is the whole shell on
first load, or the one panel that's loading inside a loaded shell; a panel
inside an already-announced skeleton adds no status of its own. Every
placeholder control sits in an `inert`, `aria-hidden` region, so nothing
that looks like a button can take focus before it works.

### Motion

One band of shine sweeps every bone at once, `--duration-shimmer` per pass.
The primitive owns it: there is no motion prop, and under
`prefers-reduced-motion` bones hold still. Never animate bones in one by one
or fade them; staggered entrances make a loading screen feel slower.

```tsx
// Correct: real labels stay, data becomes bones shaped like its stand-in
<Card>
  {["Assigned", "Activity", "Available"].map((label) => (
    <Property key={label} label={label}>
      <Skeleton width={72} />
    </Property>
  ))}
</Card>;

// Incorrect: a known label hidden behind a bone, a hand-drawn bone, and a
// spinner on top of the skeleton
<Card>
  <Skeleton width={64} />
  <div style={{ height: 10, background: "var(--surface-selected)" }} />
  <LoaderCircleIcon className={shell.spin} />
</Card>;
```
