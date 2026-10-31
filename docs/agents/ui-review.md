# UI pipeline and E2E approval

Every UI change runs the skill pipeline below, in order, then waits for the
user's sign-off before any E2E test runs.

## The pipeline

Run each skill as its own pass over the finished change, and apply its
fixes before starting the next. Later passes judge the output of earlier
ones; running them together lets a review grade work that polish would
have changed.

```text
1. emil-design-foundations   always: hierarchy, spacing, type, color, copy
2. emil-ui-polish            always: states, hit areas, layout shift, details
3. emil-ui-review            only when the review gate below says yes
```

Motion adds its own passes, triggered by what the change animates:

```text
Does the change add or change an animation?
 ├── No → skip
 └── Yes → build it with emil-animations
      └── Is it a big animation?
           ├── Yes → right after, run emil-animations again as a review,
           │         walking its "Review checklist" over the motion code
           └── No → done
```

A big animation moves more than one element, animates position, size, or
layout, or plays when a surface (dialog, popover, menu, toast, drawer)
enters or exits. A hover, press, or color transition on one element is
small.

### The review gate

`emil-ui-review` costs a full pass, so it runs only where composition can
go wrong:

```text
Is the change only copy, or one existing primitive's prop or token?
 ├── Yes → skip the review
 └── No
      ├── Does it build a component from two or more primitives?
      │    └── Yes → run the review
      └── Is it a new primitive, or a pattern listed under
          "Not in the system yet" in DESIGN.md?
           ├── Yes → run the review, even for a single primitive
           └── No → skip the review
```

A primitive is anything in `src/components/ui/`. Something outside that
folder has no settled design yet, so even a small one gets reviewed.

```text
// Review runs: a new Payee row built from Field, SearchList, and Tag
// Review runs: a new Stepper primitive, even though it is one control
// Review skips: renaming "Save" to "Save changes" on an existing Button
```

## Build the interface

Before the first pass, read the [design system](../design-system/DESIGN.md)
and the topic file for each component you use. The skills supply general
craft; DESIGN.md wins wherever the two disagree, because it encodes
decisions this app already made.

Page entry points live in `src/app/`, components in `src/components/`,
styling in `src/styles/`. Trace the feature in the live app and the code to
find what it actually uses.

## Present before E2E

1. Finish the pipeline, then present the UI in the live app shell: a direct
   feature link, screenshots of the changes, and brief notes on what to try.
2. Get the user's explicit sign-off on that presented version and the
   agreed E2E coverage. An instruction to build or verify a feature is not
   E2E approval.

```text
May I run an E2E test now?
 ├── No sign-off yet → no. Type check, lint, format, unit tests, production
 │     builds, and browser inspection and screenshots are fine.
 ├── Signed off, UI unchanged since → yes: the agreed coverage, failure
 │     reruns, and test-only fixes
 └── Signed off, UI changed since → no. Present the new version and get
       sign-off again
```

"E2E test" covers targeted Playwright specs, full suites, and runs launched
by delegated agents or CI. Prepare test changes before sign-off by the
[testing guide](testing.md). Browser automation may inspect the UI and capture
screenshots; it never executes an E2E scenario before sign-off.

## Delegating

In delegated tasks and handoffs, include the pipeline steps that apply, the
approval gate, the current approval status, the presented version, and the
approved coverage. Until approval arrives, report E2E verification as
pending user sign-off.
