# First bank connection and Starting Balance

Status: implemented locally. Targeted automated checks and fixture-based browser review passed. Live bank/database verification and E2E execution remain pending environment configuration and the required UI sign-off.

## Outcome

When a user adds a new cash or credit card account through Plaid, show one Starting Balance row representing the account's confirmed opening position. Keep purchases already included in that balance out of the spending register and review inbox. Import eligible activity after that boundary individually.

This spec follows YNAB's documented product behavior. It does not claim knowledge of YNAB's internal accounting or Plaid integration.

## Evidence and implementation baseline

YNAB creates a Starting Balance transaction using the opening balance of the day an account is linked. Earlier history is represented by that balance, and transactions cleared before its date do not automatically import. New activity imports individually for approval and categorization. See [How Direct Import Works](https://support.ynab.com/en_us/how-direct-import-works-H1IGYLgnxl), [Starting Balances](https://support.ynab.com/en_us/the-starting-balance-an-overview-H1uozOfJs), and [Linked Accounts](https://support.ynab.com/en_us/linked-accounts-in-ynab-B1991f2Cc).

Before this change, Caishen already implemented much of this behavior:

| Boundary | Current code and behavior |
| --- | --- |
| Connection | `exchangeBankToken` in `src/server/services/banks.ts` establishes the connection; account setup is a separate operation. A successful Plaid connection alone is not the accounting start. |
| Setup | `setupBankAccounts` creates `account.add` with today's date in the budget timezone and a signed opening balance. It checks revision, expected balance, update readiness, and synchronized account data. |
| Opening amount | `bankAccountOpening` in `src/server/services/bank-account-setup.ts` uses current balance, converts USD to cents, and reverses the sign for credit debt. Missing balances, unsupported currencies/types, and overpaid cards are rejected. |
| Opening boundary | The mapping stores `startDate` and an `openingSnapshot` of posted import identities and fingerprints. Pending records are not included in the posted baseline. |
| Eligibility | `bankImportEligibility` excludes unchanged opening activity and records before the start date. Changes to opening activity require investigation. |
| Review and updates | `bankInboxItems`, `applyBankUpdate`, and `resolveImport` use eligibility; import evidence is stored separately from budget transactions. |
| Accounting | `src/domain/engine.ts` initializes account balances from `account.openingBalance`. Creating an ordinary transaction for that same amount would double count it. |
| Coverage | `tests/server/bank-account-setup.test.ts` and `tests/database/bank-account-setup.test.ts` already cover baseline exclusion, changed opening activity, pending successors, and setup. |

The baseline UI had no explicit Starting Balance row treatment. The implementation adds that projection while preserving the existing import policy. Historical records in provider storage are not evidence that they were counted as spending. Diagnose any reported historical rows by tracing mapping, eligibility, resolution, and ledger transaction identity first.

## Scope and decisions

Apply this change to newly created USD cash and credit card accounts. Preserve existing loan setup, counterparty accounts, manual purchase matching, and settlement behavior.

Use the existing account opening fields as the single accounting source of truth. Project a Starting Balance row from those fields. Do not add a second financial transaction or a stored transaction kind merely to display the row. This delivers the visible YNAB behavior while retaining Caishen's accounting model.

The projected row has stable identity `opening:<accountId>`, the account opening date, payee `Starting Balance`, the signed opening amount, and cleared status. Show zero openings too. It is not a selectable purchase: exclude it from categorization, sharing, matching, merge, approval, ordinary deletion, payee learning, and spending/income reports. It contributes to running balances through the existing opening calculation exactly once. Account-specific registers show it; all-account views may show one per account with account identity visible. Existing filters can hide it, but transaction counts and review badges must not treat it as an unresolved import.

Opening balance editing and backdating are deferred. The first release shows the row as read-only and explains that it is the balance when the account was added. Do not silently create an adjustment when a user questions it. A future correction command must explicitly update the opening amount/date, reconcile affected history, and report budget consequences.

## Accounting contract

1. Setup creates one account and one mapping atomically. Repeating the operation ID cannot create another account, opening, or reserve.
2. At setup, the ledger's cleared balance equals the signed confirmed baseline balance. Pending activity is excluded from that baseline.
3. At any later point, cleared balance equals opening balance plus signed, effective posted ledger activity after the opening boundary. The displayed Starting Balance row adds no further amount.
4. Cash opening balances contribute to Ready to Assign under the existing engine rules. Credit debt contributes no cash and generates no historical category spending or funded purchase reserve. Users fund existing card debt through the existing payment category workflow.
5. Retain raw historical evidence and provider cursor progress. Exclusion from budgeting does not mean deleting provider records or resetting the cursor.
6. Reconnection and linking an existing budget account preserve its original opening and accounting history. They never create another Starting Balance.
7. Provider corrections cannot silently rewrite the opening balance or become a second historical purchase.
8. Setup failures and conflicting updates leave the previous committed budget, mappings, and import state intact.

Example: connect a card with $1,200 of confirmed debt and a $30 pending purchase. Display a -$1,200 Starting Balance. Old posted purchases produce no review tasks. The pending purchase remains eligible; its eventual posting counts once, leaving -$1,230 if nothing else changes. Existing debt does not automatically consume $1,200 from spending categories.

## Import boundary and difficult cases

Preserve `bankImportEligibility` as the shared policy used by automatic posting, review projections, and manual resolution. Do not duplicate the cutoff in UI code or add a second importer.

| Bank activity | Required result |
| --- | --- |
| Posted record captured in opening snapshot | Keep as evidence; no purchase row or category task. This includes same-day activity already reflected in the baseline. |
| New same-day posted record absent from snapshot | Import individually under the existing matching rules. |
| New record dated before the start date | Exclude from automatic posting. If reconciliation shows it changed the baseline position, surface the discrepancy for investigation. |
| Pending record at setup | Keep outside the cleared opening. Preserve identity through pending-to-posted replacement so it counts once when posted. |
| Pending purchase authorized before setup, posted afterward | Check the normalized date semantics. An authorization date before `startDate` must not discard a purchase that posts after setup. Add a failing behavioral case before altering the policy. |
| Opening record changed or removed | Preserve its evidence and surface the existing opening-history review. Do not automatically post its full amount or change the opening. |
| Uncertain identity across the opening boundary | Preserve review quarantine until resolved; do not count both candidates. |
| Repeated pages, retry, or reconnect | Preserve deduplication and the original mapping. |
| Account added later to an existing connection | Capture a baseline for that account at its setup time, independently of accounts already mapped. |

Plaid's balance and transaction feeds can reflect different update times. Continue using the synchronized account/history safeguards in `syncBanks`; an empty initial response does not prove a zero balance or completed history. Do not substitute available balance, which can include pending effects. Verify any institution-specific uncertainty against bank evidence instead of inventing an adjustment. See [Plaid Transactions API](https://plaid.com/docs/api/products/transactions/) and [pending-to-posted transitions](https://plaid.com/docs/transactions/transactions-data/).

YNAB's public documentation does not specify its exact handling of same-day snapshot races or late corrections. The safeguards above are Caishen decisions to preserve its accounting contract, rather than claims of exact internal parity.

## Implementation sequence

The [Pragmatic Programmer](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/) principles below guide the work. Each step should leave a working application.

### 1. Establish the observed gap

Trace one new-account setup through `src/components/banks/bank-account-setup.ts`, `src/components/app-shell/banks.tsx`, the service operation, persisted rows, shell model, and register renderer. Inspect current tests and identify the register's actual public projection boundary. Record findings in the implementation PR rather than creating another permanent research document.

Confirm whether the reported individual rows are pending/new purchases, historical provider evidence, or historical ledger purchases. Treat an actual historical-posting defect separately from adding the visible opening row.

This applies “avoid programming by coincidence”: verify the premise before replacing working code.

### 2. Deliver one tracer bullet

Implement a cash account's projected Starting Balance row through the existing shell model and register. Verify that a $1,000 opening displays once, has a $1,000 running balance, and creates no income, expense, or review task. Extend the same projection to credit cards and zero balances after that path works.

Keep the policy in one projection and reuse existing row presentation where appropriate. Use a discriminated view type to keep financial transaction actions unavailable for opening rows. Do not fabricate a domain transaction object to satisfy the renderer.

This applies DRY and orthogonality: account opening owns money; register projection owns presentation.

### 3. Close demonstrated import gaps

Check the cases in the import table through setup, sync, and resolution. Retain behavior that already passes. If pending successors use an inappropriate date cutoff, correct normalization or eligibility at the shared boundary and preserve stored-data compatibility. Do not widen the cutoff globally to make one example pass.

Keep operation writes atomic and stale-revision checks intact. Test a concurrent setup/sync and a lost-response retry through the service boundary.

This applies design by contract: the equations and identity rules above are the acceptance conditions.

### 4. Review setup and register copy

Explain before adding an account: “Start with your current balance. Earlier purchases are included in your Starting Balance.” Keep connection progress distinct from account setup readiness. After setup, show the account and its Starting Balance; show eligible new activity separately in review.

Read the design system and relevant topic guides before UI work. Present the implemented UI with a direct feature link, screenshots, and suggested review steps before requesting E2E execution approval.

### 5. Release without rewriting account history

The projected row requires no financial data migration. Existing accounts gain a view of their stored opening; preserve their transactions, assignments, shares, operation history, and import mappings.

Do not consolidate existing historical purchases automatically. Such consolidation can change category balances, partner ledgers, and card reserves even if the final account balance stays the same. Any repair needs a separate, reviewed per-account plan supported by evidence.

If an additional persisted field becomes necessary, follow ADR 0006: additive schema, readers before writers, stored-sample coverage, and preserved migration history. Missing legacy metadata must not trigger a fresh baseline capture. Rollback removes the projection or disables new behavior; it must not replay imports or reset cursors.

This applies reversibility: ship the smallest change and preserve the evidence needed to diagnose it.

## Verification and acceptance

Before writing tests, propose and obtain user confirmation for the public seams as required by `docs/agents/testing.md`. Suggested seams are the setup/sync service, the accounting engine's public commands/projections, and the register component. These are proposals, not recorded approvals. Use the `tdd` skill for every added or changed test; follow red/green for non-E2E work.

Acceptance examples at those seams:

- New checking account with $1,000 and old posted purchases shows one $1,000 opening, $1,000 cleared balance, and no historical review tasks.
- New card with $1,200 debt shows one -$1,200 opening, no historical spending, and no automatically funded reserve.
- A subsequent $30 card purchase changes debt once and follows normal category/reserve rules.
- Same-day snapshot purchases stay excluded; genuinely new same-day purchases remain eligible.
- Pending successors, including earlier authorization dates, post once. Opening corrections remain reviewable without changing totals silently.
- Reconnect, setup retry, concurrent sync, and adding another account do not duplicate or replace openings.
- Existing accounts retain identical account totals, Ready to Assign, category balances, card reserves, and partner ledgers after the display change.
- The opening row has stable identity and correct running balance; ordinary transaction actions cannot operate on it.

Run `npm run check` and relevant confirmed-seam tests. Run database coverage against the isolated project test database. Prepare E2E coverage for new account setup and opening display, but execute it only after explicit sign-off on the presented UI and coverage under `docs/agents/ui-review.md`. Spec approval does not constitute test-seam or E2E execution approval.

Completion requires the acceptance cases to pass, a reviewed live UI, approved E2E results when executed, and no task-created servers or temporary artifacts left behind. Do not broaden this work into historical backfill, opening correction tools, loan behavior, or an import architecture rewrite.
