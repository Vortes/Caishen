---
status: accepted
---

# Store personal budgets as rows, with engine change sets and browser sync

Each household's data was one JSON value (`Workspace.book`), read, strictly validated, and rewritten whole on every command. One unknown value written by newer code (the transaction kind `adjustment`) made older code reject the entire personal budget, and the design scales poorly: on a heavy household it grows by about 5.7 MB a year, over half of it an audit log that never shrinks, and every change re-sends the whole budget to the browser. We store personal budgets and household data as normalized rows instead, keep the accounting engine pure, and have the engine report exactly what each command changed. Every surveyed budgeting app (Actual, Firefly III, GnuCash, YNAB's API, Maybe) stores rows rather than one document.

## Storage

The household (`Workspace`) holds each partner's personal budget (`Budget`) and the data that spans both partners: shared categories, obligations, and net settlements. Every part of a personal budget is its own table, including accounts, category groups, budget categories, category targets, assignments (one per budget category per month), expected income, transactions with their shares and transaction history, loans, reimbursements, and standing rules. Bank import state is stored as rows too. Every row carries the household revision at which it last changed and a deletion flag; rows are never removed while anything may still need to learn of their deletion. Budget tables are read only through one data-access layer that leaves out deleted rows unless a caller asks for them.

The engine still runs over an in-memory budget, so the interface and agent keep using the same validated operations (ADR 0003). Each command returns a change set: the rows it added, changed, or removed, with their prior values. The server writes exactly that change set. A test compares every command's change set against a full before-and-after comparison, so a command cannot leave out a side effect such as recalculated obligations.

Command records move out of the budget into an operations table. The full command is kept for a limited period; a small record of each operation ID is kept permanently so a retried command is never applied twice.

## Stored data across code versions

Data must never be unreadable, and preventing that is the primary defense. Stored shapes change only by addition: an enum value or field is never removed or renamed in a single release, and a release that can read a new value ships before any release writes it. Each worktree uses its own Neon branch, so unmerged data never reaches other code. Tests keep a corpus of stored samples that must always load and a record of every stored enum's values that may only grow. These rules cover every stored shape, including bank import state and other JSON columns, not only transaction kinds.

Code that saves data validates it strictly. If a stored record still cannot be read, the app raises an alert immediately and shows a maintenance message in place of that partner's personal budget only. It never shows partial or wrong numbers and never saves over that budget.

## Undo, conflicts, and live updates

Undo and redo last for one browser load, as in Actual and YNAB's web app. Undo is a single general revert command that restores the prior values from a change set and passes the engine's usual checks; the browser shows the result immediately and the server confirms it. A revert is refused if any row it would restore has changed since the original command, so undo never overwrites a partner's later edit.

When a command meets a newer household revision, the server re-runs it against the latest data if the command affects only the actor's own personal budget, and reports a conflict only when the command can no longer run. Commands that affect both partners report the conflict.

The browser keeps a local copy of the signed-in partner's personal budget rows and the household's shared rows, kept between visits. It downloads them once and afterwards receives only rows changed since the revision it has, so the same engine previews every command instantly and accurately in the browser. A one-month copy was rejected because balances, card payment reserves, and category targets carry across months, and several commands check other months.

Browsers request changes when they load, reconnect, regain focus, or save, and every server response carries the current household revision, so a browser that sees a revision it did not expect fetches what it missed. A partner's change therefore appears at the next interaction rather than instantly; nothing becomes incorrect, because commands are checked against the latest revision on the server. Live notification of new revisions (for example through Neon Realtime or Ably) is deferred; the browser learns of revisions through one small interface so it can be added later without other changes.

## Considered options

Keeping the single document and hardening it (versioning, moving the audit log out, sending only the month) was rejected because the parts that grow over time, including transactions, assignments, and bank imports, would stay inside one value that is rewritten on every change. Rows only for transactions and bank imports, with smaller collections as JSON columns, was rejected because assignments also grow every month and rows let the database enforce uniqueness and references that money depends on. Event sourcing, with the command log as the source of truth, was rejected because replaying old commands through a changing engine would tie every future rule change to all past history. Finding changes by comparing the whole budget before and after each command was rejected because it costs about as much as the undo history it replaces. A separate revision for each personal budget was rejected because a shared expense or net settlement changes both partners' numbers. Persisted undo history was rejected because no surveyed app keeps undo across a reload and the persisted form was erased by any other writer.

## Consequences

Month-by-month figures are computed from rows grouped by month; cached month balances are added only if measurement shows they are needed. With no real users yet, the migration copies existing data once, confirms every month view matches the previous storage to the cent, and switches over, rather than running both storage forms side by side.
