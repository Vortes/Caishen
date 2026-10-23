import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { GuidedOnboarding } from "~/components/entry/guided-onboarding";

test("failed budget creation keeps the entered details and does not advance to categories", async () => {
  const create = vi
    .fn()
    .mockRejectedValue(new Error("Couldn’t create your budget. Try again."));
  const user = userEvent.setup();
  render(
    <GuidedOnboarding
      onCreate={create}
      onCategories={async () => undefined}
      accounts={null}
      readyToAssign={0}
      onComplete={() => undefined}
    />,
  );
  await user.clear(screen.getByLabelText("Budget name"));
  await user.type(screen.getByLabelText("Budget name"), "My home");
  await user.click(screen.getByRole("button", { name: "Create my budget" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Couldn’t create your budget",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Budget name").value).toBe(
    "My home",
  );
  expect(screen.queryByText("Make the categories yours")).toBeNull();
});
