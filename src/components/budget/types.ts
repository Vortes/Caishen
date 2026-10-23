import { type RouterOutputs } from "~/trpc/react";

export type Tab = "budget" | "transactions" | "loans";
export type Panel = {
  type:
    | "account"
    | "category"
    | "assign"
    | "import"
    | "card-payment"
    | "statement-credit"
    | "reimbursement"
    | "receive"
    | "shared-category"
    | "opening"
    | "settlement"
    | "loan"
    | "loan-payment"
    | "rate"
    | "reconcile"
    | "history";
  id?: string;
  accountId?: string;
  categoryId?: string;
};
export type State = NonNullable<RouterOutputs["budget"]["state"]>;
export type View = NonNullable<State["view"]>;
