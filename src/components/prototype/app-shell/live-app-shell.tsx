"use client";

import { useAuth } from "@clerk/nextjs";
import { InfoIcon, LoaderCircleIcon, LogInIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { currentMonth } from "~/components/budget/format";
import { api } from "~/trpc/react";
import { AppShellPrototype } from "./app-shell-prototype";
import { toShellData } from "./model";
import { applyMoves, type Move } from "./simulated-moves";
import styles from "./shell.module.css";

// Reads the signed-in budget through the production query. Nothing here
// writes: money moved in the shell is simulated over the live month (see
// simulated-moves), and the other actions stay inert.
export function LiveAppShell() {
  const { isLoaded, userId } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const state = api.budget.state.useQuery(
    { month },
    { enabled: Boolean(userId), placeholderData: (previous) => previous },
  );
  const [moves, setMoves] = useState<Move[]>([]);
  const data = useMemo(
    () =>
      state.data?.view ? toShellData(applyMoves(state.data, moves)) : null,
    [state.data, moves],
  );

  if (!isLoaded || (userId && state.isPending))
    return (
      <Status icon={<LoaderCircleIcon size={18} className={styles.spin} />}>
        <strong>Opening your budget…</strong>
      </Status>
    );
  if (!userId)
    return (
      <Status icon={<LogInIcon size={18} />}>
        <strong>Sign in to see your budget here.</strong>
        <a href="/sign-in?redirect_url=/prototype/app-shell">Sign in</a>
      </Status>
    );
  if (state.error)
    return (
      <Status icon={<InfoIcon size={18} />}>
        <strong>Your budget couldn’t load.</strong>
        {state.error.message}
      </Status>
    );
  if (!data)
    return (
      <Status icon={<InfoIcon size={18} />}>
        <strong>You don’t have a budget yet.</strong>
        <a href="/">Create one in Caishen</a>, then come back.
      </Status>
    );
  return (
    <AppShellPrototype
      data={data}
      loadingMonth={state.isPlaceholderData}
      onMonthChange={setMonth}
      moves={moves}
      onMovesChange={setMoves}
    />
  );
}

function Status({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.root} data-theme="dark" data-tint="neutral">
      <div className={styles.empty} role="status">
        {icon}
        <p>{children}</p>
      </div>
    </div>
  );
}
