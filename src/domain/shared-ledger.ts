import type { PartnerEntry } from "./partner-ledger";
import type { PartnerRequest, PartnerSettlement } from "./partner-settlements";
import type { Audit, Book, Budget } from "./engine";

export type SharedLedgerFacts = {
  version: 1;
  // The partner ledger both budgets share (src/domain/partner-ledger.ts).
  partnerEntries?: PartnerEntry[];
  // Settling up between the partners (src/domain/partner-settlements.ts).
  partnerSettlements?: PartnerSettlement[];
  partnerRequests?: PartnerRequest[];
};

export type PersonalLedger = SharedLedgerFacts & {
  kind: "personal";
  budget: Budget;
  members: { userId: string; name: string }[];
  audit: Audit[];
};

export type AccountingState = Book | PersonalLedger;

export function isPersonalLedger(
  state: AccountingState,
): state is PersonalLedger {
  return "kind" in state && state.kind === "personal";
}

export function ledgerMembers(state: AccountingState) {
  return isPersonalLedger(state)
    ? state.members.map((member) => ({
        userId: member.userId,
        name:
          member.userId === state.budget.userId
            ? state.budget.name
            : member.name,
      }))
    : Object.values(state.budgets).map((budget) => ({
        userId: budget.userId,
        name: budget.name,
      }));
}

export function projectSharedLedger(state: AccountingState): SharedLedgerFacts {
  return {
    version: 1,
    ...(state.partnerEntries?.length
      ? { partnerEntries: structuredClone(state.partnerEntries) }
      : {}),
    ...(state.partnerSettlements?.length
      ? { partnerSettlements: structuredClone(state.partnerSettlements) }
      : {}),
    ...(state.partnerRequests?.length
      ? { partnerRequests: structuredClone(state.partnerRequests) }
      : {}),
  };
}
