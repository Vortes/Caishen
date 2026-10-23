# Personal and Household Budgeting

The language used to describe spending, categorization, and decisions about how budgeted money is used.

## Language

**Personal budget**:
An individual's plan for their money and spending. Each partner has a separate personal budget; only the partner ledger is visible to both, and everything else, including categories and Reimbursements, stays private.

**Budget currency**:
US dollars (USD), used for both personal budgets, their envelope allocations, and settlements in the first version.

**Budget category (envelope)**:
A purpose to which a person allocates actual liquid cash. Money owed to you does not increase the cash available to allocate or spend from an envelope.

**Ready to Assign**:
Actual cash available to allocate that is not currently assigned to an envelope. Money owed to you never raises it, and repayments and settlements never move it; only assigning float lowers it on their account.
_Avoid_: Income

**Funding plan**:
The user's decisions about how to allocate existing Ready to Assign cash among envelopes. The user creates and applies the plan; the agent does not propose funding plans or assign this money.

**Category target**:
An amount and timing goal attached to an envelope that determines and displays its funding needs and progress using YNAB-style target behavior. It guides the user's funding decisions without assigning money or changing the cash available.

**Transaction**:
A single financial activity, such as a purchase or repayment. Its reported amount can change as the activity is finalized without becoming a second purchase or repayment.

**Transaction history**:
An inspectable record of changes to a transaction, including amount updates and records combined into it.

**Categorization**:
The assignment of spending to a budget category that describes its purpose.

**Counterparty**:
A person or organization who owes you, or whom you owe, for part of what you paid: your partner, or anyone else, such as an employer or a friend.

**Counterparty account**:
An account in your budget that holds what one kind of counterparty owes you (positive) or you owe them (negative). Every budget has a Reimbursements account; a partnered budget also has a Partner account.
_Avoid_: Obligation, receivable

**Reimbursements account**:
The private counterparty account for everyone except your partner. Each of its entries names the person or organization involved, and is filtered by them rather than given an account of its own.

**Partner account**:
The counterparty account for your partner, showing the partner ledger. Its balance is the opposite of the same account in your partner's budget.

**Paired envelope**:
The budget category that belongs to a counterparty account and holds its cash, including the entire cost of a fully reimbursable purchase. Its available amount is its float minus the account's balance, and it never resets at monthly rollover.

**Float**:
Your own cash assigned to a paired envelope, set aside to front costs for a counterparty until they repay. Assigning float lowers Ready to Assign like any other assignment.

**Share**:
The part of a transaction line that a counterparty is responsible for, including the whole line when none of the cost is yours. Half means exactly 50/50; any other amount is entered on the line, and there is no default split between partners.
_Avoid_: Split rule, shared category, obligation

**Purpose category**:
The private budget category for your portion of a transaction line. A line entirely owed by a counterparty has no purpose category.

**Write-off**:
Changing a share to zero, so the counterparty no longer owes it and the full line becomes your own spending, requiring a purpose category at that point. Every share change, including a write-off, is kept in the transaction history.

**Linked refund**:
A refund recorded against its original purchase, which returns each line's purpose category and share in proportion to the amount refunded.

**Personal share**:
The portion of an expense a person is responsible for, regardless of who paid the full charge: the line amount minus any share.
_Avoid_: Amount paid

**Personal spending**:
The cost attributable to an individual: each line amount minus its share, plus their share of their partner's purchases. This is the default basis for personal spending reports; repayments and settlements are not spending.

**Expense period**:
The period to which an expense belongs for personal spending reports, independently of when payment or repayment occurs. Rent belongs to the month in which it is due.

**Amount paid**:
The full amount of an actual payment from a person's account. It can differ from their personal share and is available separately from personal spending in reports.
_Avoid_: Personal share

**Daily review**:
A daily summary of spending, suggested categories, and automatic transaction updates that points to the persistent review inbox. Individual category suggestions can be corrected and the remaining suggestions approved together.

**Review inbox**:
A single current list of unresolved items, including transactions awaiting category approval, uncertain matches, and unexplained discrepancies. Items remain until resolved, so missed daily reviews do not create separate reports that must each be cleared.

**Account update**:
A refresh of recorded account activity using the latest available records from the financial institution. Daily updates are sufficient for the budgeting workflow; instantaneous transaction visibility is not required.

**Reconciliation**:
Comparison of recorded account activity and cleared balances against financial-institution records for the same point in time. This runs automatically; uploaded bank statements provide additional evidence to investigate discrepancies that account updates do not explain.

**Unresolved discrepancy**:
A difference between the recorded account and financial-institution records that remains unexplained after investigation, including statement comparison. It is surfaced for user input rather than silently removed through an invented adjustment; an account is reconciled only when its cleared balance matches the bank's at the same point in time.

**Partner ledger**:
The one record of what the partners owe each other, held by both budgets: each shared purchase's date, payee, amount, who paid, and the other partner's share, plus settlements between them. It shares no category, no line without a share, no other account, and nothing from Reimbursements.

**Partner's purchase**:
A partner ledger entry your partner paid for. Your part of it counts in your budget immediately and stays uncategorized, held from Ready to Assign, until you choose your own category for it.

**Recorded purchase**:
A partner ledger entry either partner records for a purchase before the payer's bank import arrives, naming who paid. It counts in both budgets at once; the payer's paired envelope doesn't move until the import pays it, so anything settled toward it meanwhile stays in that envelope.

**Import match**:
Pairing a payer's bank import with their recorded purchase, so the purchase counts once. A certain match is made as the import arrives; any other possible match waits in the review inbox for the payer to confirm, and the import doesn't count until then.

**Repayment**:
Money a counterparty pays you back. It reduces what they owe and restores their paired envelope; it is never income and never goes to Ready to Assign.
_Avoid_: Reimbursement received

**Settlement**:
A payment between the partners, such as a Venmo, Zelle, or bank transfer, or one partner paying the other's credit card. It is always recorded in both budgets at once, moves both Partner accounts, and never touches Ready to Assign; confirming it in either budget confirms it in both.
_Avoid_: Net settlement

**Request**:
One partner asking the other to pay a stated amount on a given day. What has been paid toward it is every settlement from the other partner since that day, and it closes when that reaches the amount; it has no deadline and moves no money.

**Credit card payment reserve**:
Existing cash set aside to pay a credit card, including funded purchase amounts moved from their spending categories. Paying the card consumes this reserve and reduces bank cash and card debt, without creating another expense or returning that payment amount to Ready to Assign.

**Loan account**:
A record of an outstanding loan balance and its interest and payment terms. The amount owed is debt, not cash available to allocate to envelopes.

**Loan payment category**:
A budget envelope paired with a loan account that holds actual cash allocated to loan payments.

**Payoff forecast**:
An estimate of a loan's payoff date and future interest based on its balance, payment plan, and stated rate assumptions. For a variable-rate loan, it assumes the latest confirmed rate continues until new terms are confirmed; it is distinct from actual lender-confirmed charges and balances.

**Extra-payment preview**:
A comparison showing how an additional loan payment would affect a payoff forecast. It does not change envelope allocations or initiate a payment.

**Statement credit**:
A credit applied to a credit-card account that reduces the amount owed, rather than depositing cash into a bank account. Once posted, it releases any existing payment reserve no longer needed to cover the remaining card balance into Ready to Assign.

**Overspending**:
Spending that exceeds the money available in a budget category. In a paired envelope, only what you fronted in cash counts as cash overspending, and it stays visible until it is repaid or covered with float.

**Overspending coverage**:
Moving budgeted money from another category to cover overspending. Choosing the source is always the user's decision.
_Avoid_: Recategorization

**Monthly rollover**:
The transition to a new budget month: positive available category balances carry forward, uncovered cash overspending reduces the next month's Ready to Assign, and uncovered credit spending remains debt requiring funding. Paired envelopes carry forward unchanged, including any shortfall, so money owed to you never reaches Ready to Assign.
