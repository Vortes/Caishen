---
status: accepted
---

# Invite a partner by email with a link that proves it

Partners used to connect with an eight-character code read aloud and typed into onboarding or Settings. We replace it with an invitation: the sender writes a card in Settings, chooses its paper, signs it, and sends it to the partner's email address. The link in that email is the proof. Whoever opens it, signed in to any account, can accept it; when the account's email differs from the invited address the page says so and offers to switch accounts, but does not refuse. An existing user accepts the moment they sign the card, which also merges their budget into the sender's household, so the merge warning sits on the card before the signature. A new user signs up on the invite page with the email prefilled, signs the card, and is carried into onboarding on the same page; their invitation is accepted in the step that creates their budget at the end of onboarding, because joining needs a budget to merge. A sender has one live invitation at a time; sending a new one replaces it. Resend sends the same link again, so an earlier email keeps working. An invitation expires after seven days, and the daily job wipes used, cancelled, and expired ones, address and handwriting included.

## Considered options

Requiring the accepting account's email to match the invited address was rejected: the partner's Caishen account often uses a different address from the one the sender knows, and matching does nothing for a mistyped address, which still reaches whoever owns it. A sender-side confirmation after the partner accepts was rejected: it adds a step to every invitation to cover a rare mistake, and disconnecting (ADR 0012) covers that case. Accepting a new user's invitation at the moment they sign was rejected: the join can't run until their budget exists, so one accept-and-join step at budget creation is simpler, and a closed tab mid-onboarding costs only a second click on the link. Keeping the code flow beside the email flow was rejected: two ways to connect is two sets of states to keep right. Guessing a sender's name from their email address was rejected: a name is asked for in onboarding and left blank when the identity provider has none.

## Consequences

Onboarding gains a required name step, prefilled only from the identity provider, since the card prints the sender's name and the partner's shell names the Partner account from it. The invite-code field, the code procedures, and the code components are removed; the migrations that created them stay. The privacy page and the retention policy say that an invitation holds the invited address and the sender's handwriting until it is spent or expires. Sound in the invitation needs one tap on arrival, since a link opened from email carries no gesture, and sign-up on the invite page leads with an email code because OAuth providers refuse to run inside mail apps' embedded browsers.
