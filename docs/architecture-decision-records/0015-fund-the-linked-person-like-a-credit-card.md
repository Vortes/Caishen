---
status: accepted
---

# Fund the linked person like a credit card

Under ADR 0007, when your partner shared a purchase, your part came out of Ready to Assign straight away and sat in their paired envelope. Once you gave it a category, that category spent it as cash too. A category that couldn't cover it turned red and charged next month's Ready to Assign. So your partner's envelope looked full and green while your categories were red, which reads like the same money counted twice. On prod this led to a real mistake: you moved the money set aside to pay your partner into the categories that were red, and nothing said the envelope was then short of what you owed. People already understand credit cards, where the payment category fills only as purchases on the card are funded. So owing the linked person now works the same way.

- **The linked person's account plays the card.** Your part of each of their purchases is credit spending in its category, and the card funding pass funds it from what the category holds into their paired envelope. This applies only to the linked person (ADR 0014), the one shown as "On Caishen". Other people keep ADR 0007's accounting, and so does a former partner's frozen ledger.
- **A short category is overspent on credit.** What the category can't cover is credit overspending. It resets at month end without charging next month's Ready to Assign, and it carries on the linked person's account as unfunded credit.
- **No category, no hold.** A share without a category is unfunded from the start and holds nothing from Ready to Assign. This replaces ADR 0007's rule that the non-payer's part "is held from Ready to Assign until they pick their own category".
- **The envelope.** Its available amount is float minus the account's balance minus its unfunded credit. ADR 0007's float minus balance still applies when nothing is unfunded, so the receivable side is unchanged. A settlement spends from the envelope. Paying more than it holds is cash overspending in the envelope, like a card payment larger than its reserve. You can assign to it directly, and move money out of it without a warning.
- **Still to fund** is what you owe on net, max(0, −balance), minus the envelope's available amount, never below zero. Auto-Assign's Underfunded includes it.
- **Refunds and share changes** release what was set aside back to the category, through the card refund path, up to what the categories funded and the envelope still holds. A refund the envelope can't release reduces the unfunded credit instead. When a share's amount drops, its unfunded part goes first.
- **Unchanged.** Ready to Assign keeps its definition; it is no longer reduced by these shares. The payer's own accounting, reports and Reflect don't change, so what you spent is the same however it was funded.

This amends ADR 0014's line "Float, overspending, rollover, and Ready to Assign retain ADR 0007's paired-envelope accounting" for the linked person.

## Considered options

The display was chosen from a prototype, tried first in a playground and then in the live app. The chosen design is "By purchase": the row fills in yellow toward what you owe, says "$X more needed", and turns green when everything is set aside. Its side panel lists your part of each purchase and whether it is set aside, short or needs a category. Three displays were rejected:

- **Today's screen**, which shows everything you owe as green beside red categories, was rejected because that is the confusion this fixes.
- **Like a card**, a row with only a yellow pill and no bar or status, was rejected because the gap is visible only after selecting the row.
- **Built-in target**, the chosen row with a panel of totals only, was rejected because it says how much is missing but not which purchase or category is short.

## Consequences

Prod data is not migrated and no assignment changes. After release, an envelope that ADR 0007 had filled shows what is still to fund, and assigning it is the user's call. Client format 12 refuses browsers still running the earlier accounting. A disconnected partner's ledger is replayed under ADR 0007 again (ADR 0012), so disconnecting can change that envelope's figures.
