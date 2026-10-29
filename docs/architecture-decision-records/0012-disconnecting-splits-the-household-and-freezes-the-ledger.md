---
status: accepted
---

# Disconnecting splits the household and freezes the ledger on both sides

A partnership could only end by one partner deleting their account, which left the other with a frozen "Deleted partner" account and no way to invite anyone again. We decide that either partner can disconnect from Settings, alone, after a confirmation. Each person ends up in a household of their own. The partner ledger is kept on both sides as it stood, under a closed counterparty account named after the former partner. It holds whatever balance was open, cannot be settled or added to in the app, and does not occupy the partner slot, so either person can invite someone new; partnering with the same person again starts a fresh ledger. The other partner learns of it from Settings, which names the former partner and the date; no email is sent. Account deletion becomes this same operation with the former partner's name redacted to "Deleted partner".

## Considered options

Requiring both partners to agree was rejected: it lets one person hold the other's budget hostage. Writing off the open balance on disconnect was rejected: the app cannot know whether it was paid outside it, and a frozen number is the honest record. Keeping the frozen ledger inside the Partner account was rejected: the Partner account belongs to the current partner, and a new partner needs it.

## Consequences

The Partner account is only ever the current partner's; a budget may also carry one closed account per former partner. The special case in account deletion that builds the "Deleted partner" budget is replaced by the disconnect operation plus redaction. The glossary gains Former partner, and Counterparty account's "a partnered budget also has a Partner account" now reads alongside it.
