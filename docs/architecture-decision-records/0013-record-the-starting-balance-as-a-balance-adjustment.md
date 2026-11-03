---
status: accepted
---

# Record the Starting Balance as a balance adjustment

The first bank connection spec (`docs/ynab-first-connection-spec.md`) kept each account's opening amount on the account and showed a read-only Starting Balance row built from it. Every register action then needed a rule for that row, and users could not correct a wrong opening amount. We decided the Starting Balance behaves exactly as YNAB's does. It is the account's earliest transaction: a balance adjustment with the payee "Starting Balance". The account no longer stores an opening amount.

- **One stored kind.** The Starting Balance is a transaction of the existing `adjustment` kind, the same kind reconciliation creates. That kind already shows "Inflow: Ready to Assign" on cash accounts and "Category not needed" on card, loan and tracking accounts, and never asks for a category. These are the labels YNAB shows. Its category cannot be changed, as in YNAB.
- **Edited and deleted like a transaction.** The register edits a balance adjustment's date, amount and payee, so reconciliation adjustments become editable too. Deleting the Starting Balance moves the account balance by its amount. To restore it, reconcile and rename the resulting adjustment "Starting Balance", which is YNAB's documented path.
- **Linked accounts.** Editing the Starting Balance of a linked account is allowed. The bank import boundary stays the day the account was linked; an edit never moves it. If the edit makes the account disagree with the bank, reconciliation shows an unresolved discrepancy and does not repair it.
- **Which accounts.** Every account a person adds (cash, credit card or tracking) gets one. Partner, Reimbursements and former partner accounts do not; their balances come from shared and reimbursed activity.
- **Any date.** A transaction may be dated before the day its account was added, as in YNAB, so the Starting Balance can be moved earlier and past activity added. The rule that refused activity before that day is removed. Bank imports still stop at the day the account was linked.
- **Rules keyed on the kind, not the payee.** Balance adjustments arrive reviewed and never teach payee memory. A transaction is not special because its payee is "Starting Balance".
- **Migration.** One migration turns each account's opening amount into a cleared Starting Balance dated the account's opening date, including zero amounts, and removes the stored opening amount. Under ADR 0008's pre-launch rule there is no fallback reader for the old shape.

This supersedes the spec's "Scope and decisions" section where it projects a read-only row and defers editing. Its import boundary and accounting contract stand: cleared balance is still the Starting Balance plus posted activity after it, counted once.

## Considered options

Keeping the projected read-only row was rejected because it is not YNAB's behaviour and every register action needed an exception for it. Recording it as an ordinary purchase or income was rejected: on a card it would ask for a category, so it would need a rule keyed on the payee. Making the projected row editable while keeping the amount on the account was rejected because the opening amount would then have two sources of truth.
