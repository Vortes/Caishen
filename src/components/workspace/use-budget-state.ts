"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getMutationKey } from "@trpc/react-query";
import { api } from "~/trpc/react";

// The signed-in budget for one month. A refetch while a command is saving
// would race its optimistic preview, so focus and reconnect refetches wait
// until no command is in flight. The previous month stays on screen as
// placeholder data while the next one loads. A budget under maintenance
// checks back every minute, so the plan returns on its own.
export function useBudgetState(month: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const idle = () =>
    queryClient.isMutating({
      mutationKey: getMutationKey(api.budget.execute),
    }) === 0;
  return api.budget.state.useQuery(
    { month },
    {
      enabled,
      refetchOnMount: "always",
      refetchOnWindowFocus: idle,
      refetchOnReconnect: idle,
      placeholderData: (previous) => previous,
      refetchInterval: (query) =>
        query.state.data?.status === "maintenance" ? 60_000 : false,
      trpc: { abortOnUnmount: true },
    },
  );
}
