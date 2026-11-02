# Personal and Household Budgeting

The language used to describe spending, categorization, and decisions about how budgeted money is used.

## Language

**Personal budget**:
An individual's plan for their money and spending. Each partner has a separate personal budget; only the partner ledger is visible to both, and everything else, including categories and every other person's account, stays private.

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

**Bookkeeping**:
Keeping a budget's recorded facts matching what happened: categorizing bank imports, applying remembered shares, matching transfers and imports, updating amounts as they post, and reconciling. The agent does bookkeeping. It changes what happened, never what the user planned.

**Budgeting decision**:
Any change to assigned money: a funding plan, overspending coverage, a move between envelopes or to or from Ready to Assign, or a target. Always the user's; the agent never makes or proposes one, and an agent action that would assign is refused. Ready to Assign and category balances may still rise or fall as the consequence of a booked fact, such as income, a refund, or a reclassified transfer.

**Booking**:
The agent's categorization of a bank import, or of the user's side of a partner's purchase, applied as a reviewed transaction and marked as the agent's work. Manual entries the user typed are never booked. It never waits on the user; one tap corrects it. The agent only sets what is empty or what it set itself, never a choice a user made, and it never invents a share: a share is applied only from the user's precedent, and a new payee is booked as entirely the user's own.
_Avoid_: Suggestion, suggested category, approval

**Agent status**:
The agent's current real state: resting, booked overnight, has a question, stuck because a bank needs attention, or learning. Any presence the agent has in the interface, including a character, shows only this status and never asks for anything bookkeeping does not need: no feeding, streaks, or rewards.

**Precedent**:
A categorization or share the user chose, together with the facts of that import: payee, location and store number, amount, account, day, and time. The agent books with precedent when a new import matches one on the facts that distinguish it from the others, and the booking names that fact. When precedents at one payee disagree, the agent must find the fact that separates them or it is a guess. Payee memory is not precedent: it prefills manual entries with the most recent choice, while the agent reads the user's history.
_Avoid_: Rule, memorized payee

**Guess**:
A booking with no precedent that fits. It is still booked, its mark says it was guessed, and the daily review leads with guesses. Correcting a guess makes a precedent; so does leaving it alone after seeing it in a daily review.

**Handoff**:
The first booking made from a new precedent: the agent watched the user categorize something, and now does it the same way. The daily review names each handoff.

**Evidence**:
What the agent may reason over: the import record, the user's own budget and history, and the partner ledger entries it already matches against. It may look up public facts about a merchant, such as the location a Costco store number names, but it never sends anything about the user to do so, and it never reaches the user's calendar, email, device location, or the partner's private categories.

**Payee**:
An imported transaction's payee as the bank provides it: the bank's merchant name when it gives one, otherwise the raw statement descriptor. Caishen never rewrites it, and keeps the raw descriptor on the transaction so it can always be tied back to the card or bank statement.

**Transaction**:
A single financial activity, such as a purchase or repayment. Its reported amount can change as the activity is finalized without becoming a second purchase or repayment.

**Register entry**:
A transaction or bank inbox item named once by the domain with its financial shape and the actions the register may offer. A permitted action still validates the values the user submits.
_Avoid_: Transaction variant, editable-kind list

**Transaction history**:
An inspectable record of changes to a transaction, including amount updates and records combined into it.

**Categorization**:
The assignment of spending to a budget category that describes its purpose.

**Counterparty**:
A person or organization who owes you, or whom you owe, for part of what you paid: your partner, or anyone else, such as an employer or a friend.

**Person**:
A counterparty with an account of their own in your budget, holding what they owe you (positive) or you owe them (negative), and one paired envelope in People. You add a person by name the first time you share with them. Everyone you track is a person, whether or not they use Caishen.
_Avoid_: Reimbursements, obligation, receivable, payee

**Counterparty account**:
A person's account. Shares and repayments name it, never a free-text name.

**Linked person**:
The person who is also the other member of your household: your partner, shown as "On Caishen". What you share with them is mirrored into the partner ledger, and their account's balance is the opposite of the same account in their budget. A budget has at most one.
_Avoid_: Partner account

**Invitation**:
A handwritten card one person sends by email to the partner they want. Opening its link is what proves it; it is live until it is used, cancelled, replaced by a newer one, or expires.
_Avoid_: Invite code, token

**Former partner**:
A linked person who disconnected, or whose account was deleted. Each side keeps the partner ledger as it stood, frozen under a closed, unlinked person named after the former partner, which can neither be settled nor added to and leaves the partner slot free.
_Avoid_: Ex-partner, removed member

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
A daily account of the agent's work since the user last looked, in this order: the review inbox's questions, then guesses, then handoffs, then the bookings with precedent as a count with a way in. Nothing in it waits on the user; corrections are one tap.
_Avoid_: Approval queue, suggestions to approve

**Review inbox**:
A single current list of the agent's questions: uncertain matches, unexplained discrepancies, transfers with no found other side, and anything else where being wrong would misstate money between people or between the user and the bank. Each item is a question with a proposed answer and one-tap acceptance, never a blank form. A category guess is never an inbox item. Items remain until resolved, so missed daily reviews do not create separate reports that must each be cleared.

**Bank connection**:
One login at one financial institution, authorized through Plaid, through which Caishen receives account updates for the accounts the user shares. Its status is connected, login required, pending disconnect, revoked, or disconnected, and is set from what the institution reports, never inferred from an account going unmentioned.
_Avoid_: Item, bank, Plaid connection

**Provider account**:
One account at the institution as Plaid reports it inside a bank connection, with its own identity and state. It is shared (the user shares it and updates arrive), unavailable (the user stopped sharing it and updates stopped), revoked (the user withdrew access at the institution), or retired (a newer provider account for the same account took its place).
_Avoid_: Cache entry, catalog entry, ready or unavailable list entry, Plaid account

**Linked account**:
A budget account that one provider account feeds. A budget account has at most one live feed, and the feed never changes the account's history, transactions, or reconciliation, whatever state its provider account is in.
_Avoid_: Mapping, mapped account, synchronized account

**Account update**:
A refresh of recorded account activity using the latest available records from the financial institution. Daily updates are sufficient for the budgeting workflow; instantaneous transaction visibility is not required.

**Reconciliation**:
Comparison of recorded account activity and cleared balances against financial-institution records for the same point in time. This runs automatically; uploaded bank statements provide additional evidence to investigate discrepancies that account updates do not explain.

**Unresolved discrepancy**:
A difference between the recorded account and financial-institution records that remains unexplained after investigation, including statement comparison. It is surfaced for user input rather than silently removed through an invented adjustment; an account is reconciled only when its cleared balance matches the bank's at the same point in time.

**Partner ledger**:
The one record of what the partners owe each other, held by both budgets: each shared purchase's date, payee, amount, who paid, and the other partner's share, plus settlements between them. It shares no category, no line without a share, no other account, and nothing about any other person.

**Source line facts**:
The facts inside a mirrored partner entry's source that let either partner's browser enforce share-edit rules: whether the payer's line has a purpose category and whether it is on a split purchase. They disclose no category identifier or other private value. A recorded purchase awaiting its payer's import has no source yet.
_Avoid_: Shared category, provisional preview

**Partner's purchase**:
A partner ledger entry your partner paid for. Your part of it counts in your budget immediately and is held from Ready to Assign until it has your own category, which the agent books from your precedent at that payee or which you choose. Your partner's category is never evidence for it.

**Recorded purchase**:
A partner ledger entry either partner records for a purchase before the payer's bank import arrives, naming who paid. It counts in both budgets at once; the payer's paired envelope doesn't move until the import pays it, so anything settled toward it meanwhile stays in that envelope.

**Import match**:
Pairing a payer's bank import with their recorded purchase, so the purchase counts once. A certain match is made as the import arrives; any other possible match waits in the review inbox for the payer to confirm, and the import doesn't count until then.

**Repayment**:
Money a person who isn't linked pays you back, recorded from their register or recognized in a bank import by their name. It reduces what they owe and restores their paired envelope; it is never income and never goes to Ready to Assign. The linked person pays you back by a settlement instead.
_Avoid_: Reimbursement received

**Settlement**:
A payment between the partners, such as a Venmo, Zelle, or bank transfer, or one partner paying the other's credit card. It is always recorded in both budgets at once, moves both linked people's accounts, and never touches Ready to Assign; confirming it in either budget confirms it in both.
_Avoid_: Net settlement

**Request**:
One partner asking the other to pay a stated amount on a given day. What has been paid toward it is every settlement from the other partner since that day, and it closes when that reaches the amount; it has no deadline and moves no money.

**Credit card payment reserve**:
Existing cash set aside to pay a credit card, including funded purchase amounts moved from their spending categories. Paying the card consumes this reserve and reduces bank cash and card debt, without creating another expense or returning that payment amount to Ready to Assign. A payment larger than the reserve is still recorded; the difference shows as cash overspending in the card's payment category until it is covered, and the card's unfunded debt never counts it.

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
Spending that exceeds the money available in a budget category. In a paired envelope, only what you fronted in cash counts as cash overspending, and it stays visible until it is repaid or covered with float. A card payment larger than its reserve is cash overspending in the card's payment category; the spending categories it paid for keep their own state.

**Overspending coverage**:
Moving budgeted money from another category to cover overspending. Choosing the source is always the user's decision.
_Avoid_: Recategorization

**Monthly rollover**:
The transition to a new budget month: positive available category balances carry forward, uncovered cash overspending reduces the next month's Ready to Assign, including a card payment category left negative by a payment, and uncovered credit spending remains debt requiring funding. Paired envelopes carry forward unchanged, including any shortfall, so money owed to you never reaches Ready to Assign.
