import type { View } from "~/components/budget/types";

export type SharedCategory = View["sharedCategories"][number];

export function sharePercent(weights: Record<string, number>, userId: string) {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return total ? Math.round(((weights[userId] ?? 0) / total) * 100) : 0;
}

export function partnerOf(view: View) {
  return view.members.find((member) => member.userId !== view.budget.userId);
}

export function sharedCategoryFor(view: View, categoryId: string) {
  return view.sharedCategories.find(
    (shared) => shared.categoryIds[view.budget.userId] === categoryId,
  );
}
