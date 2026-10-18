# Personal and Household Budgeting

The language used to describe spending, categorization, and decisions about how budgeted money is used.

## Language

**Personal budget**:
An individual's plan for their money and spending. Each partner has a separate personal budget, with unrelated personal spending kept private and shared-expense information visible as needed to verify settlement.

**Budget currency**:
US dollars (USD), used for both personal budgets, their envelope allocations, and shared settlements in the first version.

**Budget category (envelope)**:
A purpose to which a person allocates actual liquid cash. Expected reimbursements do not increase the cash available to allocate or spend from an envelope.

**Ready to Assign**:
Actual cash available to allocate that is not currently assigned to an envelope. Received cash reimbursements return here for reassignment without being counted as new earnings in reports.
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

**Shared category**:
A budget category with explicit participants and a rule defining each participant's share of its expenses, defaulting to equal shares with purchase-level exceptions. Each person funds the full amount they pay or owe from the relevant category, without a separate reimbursement buffer.

**Shared expense**:
An expense whose personal shares are determined by a configured shared-category rule and reflected in both participants' budgets. Either partner can set or change the rule without the other's approval; the actual account transaction belongs to whoever paid, while the other participant's share is an obligation rather than an invented withdrawal.

**Personal share**:
The portion of an expense a person is responsible for, regardless of who paid the full charge.
_Avoid_: Amount paid

**Personal spending**:
The cost attributable to an individual, including their personal shares of shared expenses. This is the default basis for personal spending reports; repayments settle amounts owed without counting as additional spending.

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

**Reimbursement**:
Money expected or received from a person or organization in return for some or all of an expense, linked to that expense and its repayment source. An expected reimbursement is not available cash; a received cash reimbursement clears the corresponding amount owed and goes to Ready to Assign, rather than restoring the original category.

**Repayment**:
An actual payment that settles some or all of an outstanding amount owed. Recording a repayment reduces that outstanding balance; producing a settlement report does not.

**Net settlement**:
A recorded settlement that offsets the partners' obligations so the person who owes more pays only the difference. Cash reserved for obligations discharged by the offset returns to Ready to Assign; the offset is not a bank deposit.

**Settlement report**:
A month-end calculation of shared expenses and the net amount the partners owe each other, derived from their categorized spending. The report describes what is owed; it is not a payment.

**Opening shared balance**:
An amount already owed between partners when they begin using the app, entered by shared category and who owes whom after any expense split has already been applied. These amounts are netted for settlement without splitting them again or creating available cash, new bank transactions, or new-period spending.

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
Spending that exceeds the money available in a budget category.

**Overspending coverage**:
Moving budgeted money from another category to cover overspending. Choosing the source is a manual decision unless an applicable standing rule has been explicitly established.
_Avoid_: Recategorization

**Monthly rollover**:
The transition to a new budget month: positive available category balances carry forward, uncovered cash overspending reduces the next month's Ready to Assign, and uncovered credit spending remains debt requiring funding. Outstanding reimbursements and shared obligations persist independently of these envelope calculations.

**Standing rule**:
An explicit, ongoing instruction from a user authorizing how a recurring budgeting decision should be handled, such as covering grocery overspending from dining out.
_Avoid_: Inferred preference
