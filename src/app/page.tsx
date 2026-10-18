"use client";

import { Show } from "@clerk/nextjs";
import { BudgetApp } from "~/components/workspace/budget-app";
import { Welcome } from "~/components/auth/welcome";

export default function Home() {
  return (
    <>
      <Show when="signed-out">
        <Welcome />
      </Show>
      <Show when="signed-in">
        <BudgetApp />
      </Show>
    </>
  );
}
