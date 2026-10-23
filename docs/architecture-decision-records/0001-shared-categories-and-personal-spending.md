---
status: shared-cost and reimbursement parts superseded by ADR-0007
---

# Shared categories across separate personal budgets

Each partner keeps a separate personal budget, with unrelated spending private and shared-expense details visible as needed to verify settlement. Explicit shared-category rules, defaulting to equal shares with purchase-level exceptions, determine personal shares and the amounts owed between partners; full payment amounts remain available separately, while personal spending reports default to each person's share. This preserves category-based budgeting while replacing manual shared-expense splitting and settlement calculations, at the cost of maintaining a distinction between personal cost, actual payments, and outstanding reimbursements.

Initial setup imports only the existing YNAB categories, not account balances, envelope allocations, transaction history, or reimbursement balances. Bank accounts are connected through Plaid, and existing loans with their interest terms are added separately.

Setup must support entering opening shared amounts owed from before the app's start date, separately from the categories-only YNAB import. A dedicated workflow for automatically handling merchant refunds after a shared expense has been settled is deferred from the first build.

Enter opening obligations by shared category and direction, using amounts already owed after splitting, and calculate the net balance without halving those amounts again. Either partner may set or change shared-category rules without confirmation or approval from the other partner.

Initial loan workflows must cover variable-rate student loans and fixed-rate personal loans, with loan accounts paired to payment categories.

The first version serves users in the USA and uses USD for both budgets and all shared settlements. Initial Plaid institution targets are Chase, American Express, and Discover; actual account and product eligibility must be verified during connection setup.
