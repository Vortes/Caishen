import type { View } from "~/components/budget/types";

export function partnerOf(view: View) {
  return view.members.find((member) => member.userId !== view.budget.userId);
}
