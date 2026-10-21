import { focusManager } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { State } from "~/components/budget/types";
import { renderShell, stateFixture } from "./shell-harness";

const maintenance: State = {
  status: "maintenance",
  view: null,
  revision: 7,
  history: { undo: null, redo: null },
  services: [],
  connections: [],
  evidence: [],
  imports: [],
};

test("a budget the server can't read shows maintenance in place of the plan, then the plan once it reads again", async () => {
  let current: State = maintenance;
  const { read } = await renderShell({ read: () => current, plan: false });

  const title = await screen.findByText("We’re doing some maintenance.");
  expect(title.closest("[role=status]")?.textContent).toBe(
    "We’re doing some maintenance.Your plan will be back in a couple of minutes. Check back later.",
  );
  expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();

  current = stateFixture();
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await screen.findByRole("heading", { name: "Plan" });
  expect(read).toHaveBeenCalledTimes(2);
  focusManager.setFocused(undefined);
});
