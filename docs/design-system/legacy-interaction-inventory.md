# Legacy interaction inventory and new-UI gap analysis

Phases 1-2 of the UI migration groundwork: every legacy interaction that
reads from or writes to the backend, what the new UI (the app shell at
`/prototype/app-shell`) has today, and a prioritized build list.

Method: read the code (per-feature `commands.ts`, `use-budget-command.ts`,
`optimistic-cache.ts`, `optimistic-state.ts`, `use-workspace-history.ts`,
`src/server/api/routers/budget.ts`) and clicked through both UIs as a
signed-in test user over the seeded demo workspace (`npm run db:seed`).

## How the backend path works (shared by every write)

- Every budget write is a domain `Command` sent to `budget.execute` with
  `expectedRevision`. `useBudgetCommand` previews it optimistically by
  running the real engine projection on the cached `budget.state`
  (`optimistic-state.ts`), rolls back on error (keeping any newer server
  response), and invalidates on settle. A new command is refused while any
  mutation is in flight, while a month is loading, or after a refresh
  outage (`run()` in `budget-app.tsx`).
- `mutateWorkspace` records each user command batch as one entry in a
  per-user, per-revision history (JSON patches, limit 50).
  `budget.changeHistory` applies undo/redo with `expectedRevision` and an
  `operationId`. The history is keyed to the actor and revision, so **any
  revision bump outside the history path (a partner edit, a bank import
  resolution, a join) empties the undo stack by design.**
- `useWorkspaceHistory` binds Cmd+Z / Cmd+Shift+Z / Ctrl+Y with guards: no
  undo while a mutation is in flight or locked, while a dialog or the
  transaction editor is open, after a failed refresh, while focus is in an
  input/textarea/select/textbox/dialog, or on key repeat. Success shows the
  "Action undone/redone." toast; errors surface in the workspace notice and
  refetch state.
- Not on the history path (not undoable): `budget.onboard`, `invite`,
  `join`, `sync`, `reconcile` (writes evidence only), the Plaid procedures,
  `mapBankAccount`, `setupBankAccounts`, and `resolveImport` (it executes
  the transaction command directly and bumps the revision, which also
  clears the existing undo stack).

Status legend for the "New UI" column:
**real** (present and wired to the backend), **simulated** (present but
local-only), **inert** (control exists, does nothing), **missing**,
**different** (intentionally moved or replaced).

## Workspace chrome and sidebar

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases handled | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Load budget state | Skeleton "Opening your personal budget…", then the workspace. Failures show a full-page error with Try again. | `budget-app.tsx` → `budget.state` query | n/a | Refetch on focus/reconnect is skipped while a save is in flight; `placeholderData` keeps the old month visible; stale-user guard; known issue #3: `refetchOnMount: "always"` double-read (do not copy) | foundation | **real** (`live-app-shell.tsx`), simpler error/empty states, no mutation-aware refetch guards yet |
| Month navigation | Prev/next arrows, month-input popover, Today button; thin progress bar + `aria-busy` while the month loads; prev disabled before `startMonth` | `month-picker.tsx`, local state → `budget.state` re-query | n/a | Open dialog closes on month change | foundation | **real** (`MonthNav`); month-input popover dropped - clicking the label jumps to today (**different**); loading bar present |
| Undo / redo | Cmd+Z undoes, Cmd+Shift+Z / Ctrl+Y redoes; toast "Action undone/redone."; no visible buttons (keyboard-first, on purpose) | `use-workspace-history.ts` → `budget.changeHistory` | is the undo | All guards above; repeated keys locked; rejected undo preserved and retryable; email-cancellation warning surfaced after settings undo | undo (9 tests) | **missing**. The move-money toast Undo only pops a local simulated move |
| Success toast / error notices | Green toast, 4s auto-dismiss; red dismissible error banner; persistent "couldn't refresh" banner with Try again that blocks further writes | `budget-app.tsx` notice/formError/refreshError | n/a | Errors from `transaction.upsert` stay in the editor instead | optimistic-updates | **missing** (no toast or notice surface; Toast primitive in TODO) |
| Navigate Plan / All accounts / Loans / Settings | Sidebar buttons; pending-review count badge on All accounts | `workspace-sidebar.tsx` (reads state) | n/a | Navigation clears selection, panels, editor, errors | foundation, mobile-navigation | **real** for Plan / Reflect / All accounts / Loans incl. review badge; Settings button **inert** |
| Account list → account register | Cash/Credit groups with balances, collapse; click opens that account's register | `workspace-sidebar.tsx` | n/a | Negative balances tinted | bank-register | **real**, plus connection-warning dot |
| Add account | Sidebar button → dialog (name, kind, opening balance, date) | `accounts/commands.ts` → `account.add` | yes - removes the account | Credit opening balance forced negative | foundation | sidebar + button **inert** → **missing** |
| Budget menu | Budget name dropdown → Budget settings, Import categories | `workspace-sidebar.tsx` | n/a | - | - | switcher **inert** → **missing** |
| Mobile navigation drawer | Hamburger opens sidebar dialog; closes on navigate; focus returns | `budget-app.tsx`, `workspace-sidebar.tsx` | n/a | Reopens after view switches | mobile-navigation | **different**: narrow mode uses scrim drawers with `[`/`]`, Esc |

## Plan (budget screen)

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases handled | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Filter chips | All / Overspent / Underfunded / Snoozed / Money available with live counts; Overspent tinted when > 0 | `category-table.tsx` (client filter) | n/a | - | plan-auto-assign | **real** (`plan-views.tsx`), adds Overfunded, YNAB cash-vs-credit tint, persisted per device, chip reselect clears | 
| Category search | Find-a-category input filters rows | `budget-plan.tsx` | n/a | Empty state "No categories match" | - | **missing** (Filter icon button is **inert**, shortcut F reserved) |
| Select categories | Row click selects + opens inspector; checkboxes multi-select; group and select-all checkboxes with indeterminate | `budget-plan.tsx`, `category-table.tsx` | n/a | Focus restored on inspector close; compact viewport uses a dialog inspector | plan-auto-assign | **real** (row click toggles, `x` key, arrow-key row navigation; multi-select details card) |
| Inline assigned edit | Click the Assigned amount → input; Enter/blur commits, Esc cancels; supports math (`600+1000`, `-250`); row and totals update instantly | `assigned-input.tsx`, `assigned-amount.ts` → `assign` (delta) | yes - restores previous assignment | Parse errors to workspace notice and keep editing; retry of the same amount reuses the command id (idempotent); focus returns to the button; blocked while busy | undo ("one undoable action"), optimistic-updates | **missing** - Assigned column is read-only text |
| Move money / cover overspending | Available pill opens the YNAB popover: amount prefilled, searchable destination list with balances; Cover mode when overspent; insufficient-balance validation before sending | `move-money-popover.tsx` → `assign` or `cover` | yes | Field-level errors; Ready to Assign as either side; keyboard listbox | plan-auto-assign; prototype-move-money | **simulated** (`move-money.tsx` + `simulated-moves.ts`): identical UX, local replay only, local undo toast. The flagship gap |
| Ready to Assign → Assign dialog | Header amount (Overassigned state) + Assign button → dialog: amount, category, optional "from category" | `assignment-form.tsx`, `category-commands.ts` → `assign` / `cover` | yes | Warns when no categories exist | foundation | RtaCard **real** display incl. Overassigned; "Assign money" / "Fix overassigned" button **inert** |
| Add category | Toolbar button → dialog (name, group) | `category-commands.ts` → `category.add` | yes | - | foundation | **missing** |
| Import categories (YNAB) | Dialog: paste or file-pick an export; "Import categories only" | `budget-app.tsx` → `budget.importCategories` | yes (one batch) | 2 MB file cap, parse errors shown; dedup ids by content hash | - | **missing** |
| Group collapse | Chevron collapses a group; totals stay | `category-table.tsx` | n/a | - | - | **real** |
| Empty states | No categories → guided "add account / category" actions; no filter match | `budget-plan.tsx` | n/a | - | foundation | partial: copy-only empty states, action buttons **missing** |

## Plan inspector (details panel)

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases handled | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Expected income edit (Cost to Be Me) | Inline amount; blur/Enter saves; meter + verdict vs targets | `cost-to-be-me.tsx` → `income.expect` | yes | Dedupe of double submit (Enter then blur); slow save never overwrites typing; clearing sets null; negative rejected | - | Cost to Be Me tab is **real** read-only (meter, verdict); the income edit is **missing** |
| Available section | Totals for selection/month; card-payment breakdown; split "for partner / spendable"; personal spending vs paid | `available-section.tsx` (reads) | n/a | Cash vs credit overspending split with different copy | foundation | **real** equivalents spread over details cards (month card, category card, Shared tab) |
| Quick-assign shortfall | "Assign $X" buttons: card shortfall without target; target "needed" | `available-section.tsx`, `target-section.tsx` → `assign` | yes | Caps at Ready to Assign; disabled at 0 | foundation | **missing** (inspector shows "needed", no action) |
| Cover overspending / Move money buttons | Same move popover from the inspector | → `assign` / `cover` | yes | - | prototype-move-money | **simulated** (same popover as plan rows) |
| Target create / edit / delete | Editor with cadence tabs (weekly/monthly/yearly/custom; card-monthly/card-payoff; loan), behavior picker (set aside / refill / balance), repeat, due dates; Delete removes | `target-section.tsx` → `target.set` | yes | Paired-account/loan cadences restricted; balance behavior only custom-no-repeat; editor closes when the saved target changes | foundation | Target tab shows goal/due/funded meter (**real** read-only); Create/Edit/Delete **missing** ("Create target" is **inert**) |
| Snooze target | Switch on the summary, current month only | → `target.snooze` | yes | Hidden for card targets and non-current months | - | **missing** (snoozed state is displayed) |
| Auto-Assign | Option list with live amounts (Underfunded, Assigned/Spent last month, averages, Reduce overfunding, resets). Whole-month: preview dialog listing every change, RTA-after, "short"/"stuck" notes, then apply. With a selection: applies immediately | `auto-assign-section.tsx`, `~/domain/auto-assign` → `assign.batch` | yes (one entry) | Options disabled when no changes; Reduce overfunding whole-month only; RTA-exhaustion hints | plan-auto-assign | Options with live amounts **real** for month/selection/category scopes, but buttons **inert**; preview dialog **missing** |
| Card balance section | Paired card: balance breakdown + Record payment / Statement credit dialog openers | `category-inspector.tsx` | (dialogs yes) | - | foundation | category card shows "Pays" link only → actions **missing** |
| Reimbursements | "Expected back" list; + opens expect dialog; "Received" opens receive (cash) or statement-credit dialog | `reimbursements/commands.ts` → `reimbursement.expect`, `reimbursement.receive`, `card.credit` | yes | Settlement receipts share the receive dialog; claim linking | foundation | Reimbursements tab lists outstanding (**real** read-only); actions **missing** |
| Partner invite / join | Create invitation code (copy to clipboard), enter partner's code | `share-category.tsx` → `budget.invite`; dialog → `budget.join` | no | Code expiry, reuse, self-join, serializable merge with retries | foundation | **missing** |
| Share category / edit split | Share button on a category → shared-category dialog (percent split); edit rule; delete with typed confirm step | `shared-expenses/commands.ts` → `shared.create`, `shared.rule`, `shared.remove` | yes | Needs partner; delete blocked when activity exists; both-budget effects | foundation, optimistic-updates | Shared split shown on category card (**real** read-only); actions **missing** |
| Shared statement | Month statement with per-line popovers (purchases, splits, carried/opening), Settle up → settlement dialog, Confirm receipt, Add opening amount | `shared-balance.tsx` → dialogs → `settlement.record`, `settlement.receive`, `opening.add` | yes | Offset-only settlements; pending vs confirmed; current-month-only recording | foundation | Shared tab shows you-owe/owed-to-you totals (**real** read-only); statement detail + all actions **missing** |
| Reconciliation summary | Last evidence results (Matched / Needs review) | `category-inspector.tsx` (reads `state.evidence`) | n/a | Evidence invalidated by newer revisions | foundation | **missing** |

## Transactions (register)

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases handled | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Review banner + review filter | "N items need your review" banner → View; View dropdown (All / Needs review); review list spans all months; clear-filter chip | `transaction-register.tsx` | n/a | Banner hidden in review mode | bank-register | **real** ("To review" toggle with count; cross-month) |
| Add transaction (inline editor) | Editor row pinned above the list: account, date, payee (datalist of past payees), category combobox with balances, outflow/inflow (mutually exclusive), posted/pending; details: expense month, shared category, own-share override; Save / Save and add another; Esc cancels | `transaction-editor.tsx`, `transaction-draft.ts` → `transaction.upsert` | yes | Per-field validation with focus-to-error; double-submit fingerprint dedupe; stale-draft conflict ("saved in another session") detection; draft survives a failed save; save-and-add keeps date/account/status; mobile autofocus suppressed | transaction-entry, optimistic-updates, undo | **missing** entirely |
| Edit transaction | Category cell (purchase/income/refund only) reopens the editor; account locked; category can't be cleared; kind-specific commands directed elsewhere | same → `transaction.upsert` with `revision` | yes | "No longer available" fallback if deleted meanwhile; partner-edit conflict message | transaction-entry, optimistic-updates | selecting a row shows read-only details (**real**); editing **missing** |
| Transaction history | Payee click → dialog with the change history | `transaction-history.tsx` (reads) | n/a | - | - | **real** (History tab in details) |
| Select + approve | Checkboxes, select-all, footer selection summary with net amount and Clear; Approve (n) marks reviewed | `transaction-register.tsx` → `transaction.approve` | yes | 500 cap with tooltip; uncategorized purchases block the optimistic preview; only unreviewed counted | bank-register | **missing** (no register selection; details "Mark reviewed" button **inert**) |
| Category suggestions (AI) | Collapsible panel: Suggest for selected purchases (OpenRouter), per-row Apply, batch Approve selected suggestions | `category-suggestions.tsx` → `budget.suggest`, `transaction.categorize`, `budget.approveSuggestions` | applies yes; suggest no | Disabled without service config; 100 cap; skips reviewed/changed rows; idempotent operation ids | - | **missing** |
| Search payee | Search box filters by payee across rows and imports | `transaction-register.tsx` | n/a | Scroll reset on filter change | large-register | **missing** |
| Large-register virtualization | > 100 rows virtualize; Home/End; focus pinning keeps the focused row mounted; skip link | `transaction-register.tsx` | n/a | Spacer rows aria-hidden | large-register | **different**: day-grouped list, no virtualization yet (fine until registers grow) |
| Register header | Posted + pending = working balance; credit reserve/shortfall | `register-header.tsx` (reads) | n/a | Pending outflows only up to the shown month | bank-register | **real** (header + account details card) |
| Account actions menu | Reconcile a statement, Record card payment, Statement credit dialogs | `register-actions-menu.tsx` → dialogs (`budget.reconcile`, `card.payment`, `card.credit`) | reconcile no; payments yes | Menu returns focus before opening the dialog | foundation | **missing** |
| Bank import rows + review dialog | Import rows interleaved, badge for reason; dialog: map provider account (budget account + start date), confirm as new transaction (category required for outflows), match an existing same-account/date/amount transaction, or ignore; update history | `bank-import-row.tsx`, `bank-import-review.tsx` → `budget.mapBankAccount`, `budget.resolveImport` | **no**, and resolving clears the undo stack (revision bump outside history) | Removed/errored imports flagged; duplicate guards; revision conflict message; payment-matching guidance | bank-register | rows appear with inbox icon and reason (**real** read-only); "Review import" button **inert**; the whole resolution flow **missing** |

## Loans

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases handled | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Add loan | Header button → dialog (principal, rate, minimum, fixed/variable, paired category) | `loans/commands.ts` → `loan.add` | yes | Auto-creates payment category when none chosen | foundation | **missing** |
| Record lender payment | Dialog: account, date, principal, interest | → `loan.payment` | yes | - | foundation | **missing** |
| Update confirmed rate | Variable loans only | → `loan.rate` | yes | - | - | **missing** |
| Extra-payment preview | Inline input re-forecasts payoff/interest client-side | `loans-view.tsx` (client only) | n/a | "Changes no funding" disclaimer | - | **missing** (details show forecast read-only, **real**) |

## Settings

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases handled | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Preferences form | Name, timezone, email hour, email toggle; Save → toast "Preferences saved." | `settings-view.tsx` → `settings.update` | yes | Deliberately no optimistic preview (would remount the form); failed email-queue cancel surfaces a retry message; undo re-checks email cancellation | undo, optimistic-updates | **missing** (no settings screen) |
| Standing rules | Removed (owner decision): no longer offered or stored | - | - | - | - | **removed** |
| Update accounts (bank sync) | Button → sync all connections; toast "Accounts updated. Check your review inbox." | → `budget.sync` | no | Disabled without connections | plaid-oauth | **missing** |
| Bank connect / reconnect / set up accounts | Plaid Link SDK flow, OAuth return continuation, retry sync, "Set up accounts" naming flow (account + start date each) | `banks/*` → `plaidLinkToken`, `plaidExchange`, `plaidReconnect`, `setupBankAccounts` | no | OAuth origin redirects; resumable sessions; partial setup retry; duplicate-add guards | plaid-oauth, bank-account-setup | status surfaces are **real** (warning dot, sync property); every action **missing**, "Reconnect" tag is a state label, not a button |
| Services status / audit list | Read-only service config and recent command audit | `settings-view.tsx` (reads) | n/a | - | - | **missing** (audit partly superseded by Reflect?) |

## Onboarding

| Interaction | What the user does and sees | Code → backend | Undoable | Edge cases | E2E | New UI |
| --- | --- | --- | --- | --- | --- | --- |
| Create budget | Name + timezone form when no workspace exists | `onboarding.tsx` → `budget.onboard` | no | Error inline; refetch on success | foundation | **different**: shows "Create one in Caishen" link back to the legacy app |

## New-UI-only surfaces (no legacy counterpart)

- **Reflect**: Spending Breakdown / Trends over `budget.spending` (real
  read), filters, drill-down, open-transaction jump into the register.
  Real and read-only; nothing to rebuild.
- Panel management (`[`, `]`, resize, peek), palette picker, theme switch:
  prototype chrome, no backend.

---

# Phase 2: what to build, in order

Ranked by how often a user hits it × how broken the new UI is without it.
Each item becomes one branch + PR (phase 3). All writes reuse
`useBudgetCommand` / `use-workspace-history` so one undo stack spans both
UIs; where a hook is tangled with legacy UI (e.g. the notice/toast wiring in
`budget-app.tsx`), extract it rather than duplicating it.

### P0 - the new UI misleads or dead-ends daily flows

1. **Real move money / cover overspending.** Replace `simulated-moves.ts`
   with the `assign`/`cover` commands through the optimistic cache. The
   popover UX already matches legacy. Includes the undo story (below) since
   its toast currently fakes one. Needs: Popover surface, text/amount
   field, combobox primitives (TODO.md), Toast.
2. **Workspace history in the shell.** Mount `useWorkspaceHistory`
   (extracted from legacy wiring) with the same guards, plus a shared
   toast/notice surface for "Action undone/redone." and command errors.
   Prereq for every later item.
3. **Inline assigned editing** on plan rows (click-to-edit with the math
   parser, delta `assign`, idempotent retry). Needs an inline amount-field
   primitive.
4. **Transaction entry and editing.** The largest piece: draft validation
   (`transaction-draft.ts` is already UI-free - reuse as is), payee
   suggestions, category combobox, details (expense month, shared, own
   share), save-and-add-another, stale-draft conflicts. Where it lives is a
   judgment call (below).
5. **Approve / mark reviewed**: register multi-select + batch
   `transaction.approve`, and the details-card "Mark reviewed" button.

### P1 - weekly flows

6. **Auto-Assign actions**: wire the existing option lists to
   `assign.batch`, with the whole-month preview (needs Dialog primitive).
7. **Assign from the Ready to Assign card** and the quick-assign shortfall
   buttons (target "needed", card shortfall).
8. **Target create / edit / delete / snooze** in the category details card.
9. **Add category** (and category search behind the inert Filter button).
10. **Bank import review**: map account, confirm / match / ignore from the
    register details card (the "Review import" button). Document that it
    clears the undo stack.
11. **Add account** (sidebar + button).
12. **Expected income edit** in Cost to Be Me.

### P2 - occasional and setup flows

13. **Settings screen** (preferences, bank connections,
    update accounts, services). Largest new surface; until it lands the
    legacy settings page keeps covering it.
14. **Loans actions**: add loan, record payment, update rate, extra-payment
    preview.
15. **Reimbursements**: expect / receive / statement credit.
16. **Shared expenses**: invite/join, share category + split editing,
    statement detail, settle up, confirm receipt, opening amounts.
17. **Reconcile a statement** and the reconciliation summary.
18. **Import categories (YNAB)**, **category suggestions (AI)**,
    **onboarding**.

### Primitives these need (beyond `src/components/ui/` today)

Matches TODO.md / issue #1: Row, NavItem, menu row, Popover surface, Dialog
(Radix AlertDialog base), text field + amount field, Select, combobox,
Toast, filter chip, pressable funding pill; move the funding components out
of the prototype. Each gets its API proposed first, a CSS module, a docs
topic file, and a specimen on `/prototype/app-shell/design-system`.

### Judgment calls (flagged for your decision)

- **Visible undo.** Recommendation: keep undo keyboard-first everywhere,
  but keep the move-money toast's Undo button and wire it to the real
  `changeHistory` undo with the same guards - moving money is the one
  high-frequency action done mid-flow where reaching for the keyboard
  breaks rhythm. Case against: a second undo entry point can race the
  shortcut and the toast can outlive undoability (partner edit, import
  resolution); if that complexity bites, drop the button and keep a plain
  confirmation toast.
- **Where transaction editing lives.** Recommendation: build entry/editing
  in the register itself (a pinned editor row, like legacy) rather than the
  inspector - batch entry is keyboard-serial and the inspector is too
  narrow for 7 fields. Case against: the new UI's selection model points at
  the inspector, and an inspector form would reuse the details layout; I'll
  put both variants behind a toggle on one prototype page before
  committing.
- **Dialogs vs popovers for small commands** (add category, add account,
  targets). Recommendation: popover-anchored forms for one-or-two-field
  commands (add category), Dialog for multi-field or destructive ones
  (accounts, targets, delete confirms). Case against: two surfaces to
  maintain; if the split feels arbitrary in use, standardize on Dialog.
- **Bank import review placement.** Recommendation: keep it in the
  register details panel (selection-based) instead of a modal, since the
  new UI already selects import rows. Case against: mapping a new provider
  account is a multi-step form that may cramp the panel.
- **Legacy audit list**: propose dropping it from the new UI (Reflect plus
  transaction history cover the need); say so rather than porting it.
- **Virtualization**: defer until a register exceeds ~100 rows in real
  use; the day-grouped list changes the math from legacy's flat table.
