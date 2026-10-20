import type { State } from "~/components/budget/types";

// Moving money in the prototype never writes to the budget. Each move is kept
// in the browser and replayed over the month it was made in, the way the
// engine books one: the source's assignment goes down and the destination's
// goes up, with Ready to Assign standing in for either side. Other months
// show the budget as saved.

export const READY_TO_ASSIGN = "ready-to-assign";

export type Move = {
  id: string;
  month: string;
  from: string;
  to: string;
  amount: number;
};

export function applyMoves(state: State, moves: Move[]): State {
  const view = state.view;
  if (!view) return state;
  const changes = new Map<string, number>();
  const add = (id: string, amount: number) =>
    changes.set(id, (changes.get(id) ?? 0) + amount);
  for (const move of moves) {
    if (move.month !== view.month) continue;
    add(move.from, -move.amount);
    add(move.to, move.amount);
  }
  if (!changes.size) return state;

  const categories = view.categories.map((category) => {
    const change = changes.get(category.id);
    if (!change) return category;
    const assigned = category.assigned + change;
    const available = category.available + change;
    const progress = category.targetProgress;
    return {
      ...category,
      assigned,
      available,
      spendable: category.spendable + change,
      cashOverspending: Math.min(
        category.cashOverspending,
        Math.max(0, -available),
      ),
      // What a target still needs is what it asks for this month less what's
      // assigned, for every target kind the engine tracks.
      targetProgress: progress && {
        ...progress,
        funded: Math.max(
          0,
          progress.funded +
            Math.max(0, assigned) -
            Math.max(0, category.assigned),
        ),
        needed: progress.snoozed
          ? 0
          : Math.max(0, progress.required - Math.max(0, assigned)),
      },
    };
  });
  return {
    ...state,
    view: {
      ...view,
      readyToAssign: view.readyToAssign + (changes.get(READY_TO_ASSIGN) ?? 0),
      categories,
      costToBeMe: categories.reduce(
        (sum, category) =>
          category.targetProgress
            ? sum +
              Math.max(0, category.assigned) +
              category.targetProgress.needed
            : sum,
        0,
      ),
    },
  };
}
