# Use a shared accounting engine for interface and agent actions

The interface and agent use the same validated accounting operations, whose balance effects are calculated by deterministic application code from the recorded facts and agreed budgeting rules. The agent interprets records, proposes categories and matches, explains discrepancies, and performs authorized actions; it does not invent balance calculations or adjustments to force reconciliation. This keeps the financial result consistent regardless of who initiates an action, while preserving review for uncertain matches and discrepancies that remain unexplained after bank-statement investigation.

Use OpenRouter for the initial model integration. Keep model access separate from accounting operations so local models, including an LM Studio endpoint, can be evaluated later without changing the budgeting rules.

Reconciliation must compare compatible balances and activity at the same cutoff, preserving source timestamps and pending versus posted status. A cached provider balance alone does not establish reconciliation; stale or incomparable records remain visibly unresolved until sufficient evidence is available.
