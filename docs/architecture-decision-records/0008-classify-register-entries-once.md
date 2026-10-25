---
status: accepted
---

# Classify register entries once and save them through one command

The browser previews commands over a PersonalLedger, while the server applies them to the household Book. The register, its draft translator, and the engine each inferred a transaction's shape and permitted actions independently. Counterparty accounts appeared in the account picker, and the non-payer's browser accepted a share reduction the payer's budget refused. Separate payment commands also enforced different date rules.

- **Register entries.** One pure domain function, `classifyRegisterEntry`, names each transaction or bank inbox entry's shape and capabilities. Register actions, drafts, field controls, register rows, and engine edit checks read that classification. Input validation still checks the amounts, dates, and other values the user submits. Direct entries exclude Partner and Reimbursements accounts.
- **Source line facts.** A mirrored partner entry's optional source holds its transaction and line identifiers and two required booleans: whether the line has a purpose category and whether it belongs to a split purchase. These facts let the non-payer's browser enforce the same refusals as the payer's engine without receiving a category identifier, another budget's payee, or any other private value. An entry without a source remains a real recorded purchase waiting for its payer's import. Changes to these facts are included in change sets even when no shared amount or payee changes.
- **One register command.** `transaction.upsert` records and edits purchases, income, refunds, transfers, card payments, and loan payments, and records statement credits. It accepts optional `transferAccountId`, `loanId`, and lender-confirmed `interest`. The `transaction.save`, `loan.payment`, `card.payment`, and `card.credit` command types are deleted. Loan dates are checked in the surviving payment path. There are no aliases or compatibility handlers.
- **Before launch.** ADR 0006's additive-only stored-shape rule and its requirement to deploy readers before writers are suspended until the first production launch. Before that launch, removed shapes are removed from committed contracts and stored samples, and required facts need no fallback for older rows. The `refundOfTransactionId` column that the linked-refund removal left unread is dropped rather than kept. At the first production launch, both ADR 0006 rules resume; this suspension does not authorize unreadable production data afterward.

## Considered options

Sending affected commands only to the server or presenting a provisional browser preview was rejected because the browser must apply the same rules. Copying the payer's category identifier into the partner ledger was rejected because categories stay private. Keeping command aliases or tolerant readers until launch was rejected because there is no launched data to preserve. A rules registry, another validation framework, and splitting the accounting engine into modules are unnecessary for this change.

## Consequences

Bank inbox items carry eligibility as data, with refusal messages defined in the domain and shared by the server. Connection and quarantine errors remain separate from eligibility. The pure engine, row change-set oracle, partner privacy boundary, and dependency direction remain unchanged: components and server services depend on the domain, and the domain depends on neither.

Existing partner entry sources without the two booleans cannot be read. Before deploying this change, the owner must reset or re-synchronize those rows and reset any stored change sets containing their old shapes. Household loading does not repair them: strict reading happens first, and source synchronization follows transaction edits. Browsers use a new client format so confirmed rows are downloaded again. Pending browser commands are held only in memory; stored server command records remain opaque records rather than parsed commands. This decision adds no data migration or backfill; the schema change adds columns without inventing facts for existing sources.
