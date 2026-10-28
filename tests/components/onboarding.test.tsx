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
  await user.type(screen.getByLabelText("Your name"), "Mei");
  await user.clear(screen.getByLabelText("Budget name"));
  await user.type(screen.getByLabelText("Budget name"), "My home");
  await user.click(screen.getByRole("button", { name: "Create my budget" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Couldn’t create your budget",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Budget name").value).toBe(
    "My home",
  );
  expect(screen.queryByText("A few questions about you")).toBeNull();
});

test("the basics step asks for your name, prefilled only from the profile, and will not advance without it", async () => {
  const create = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  const props = {
    onCreate: create,
    onCategories: async () => undefined,
    accounts: null,
    readyToAssign: 0,
    onComplete: () => undefined,
  };
  const blank = render(<GuidedOnboarding {...props} />);
  expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe("");
  await user.click(screen.getByRole("button", { name: "Create my budget" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Tell us your name",
  );
  expect(create).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Your name"), "Mei Chen");
  await user.click(screen.getByRole("button", { name: "Create my budget" }));
  await screen.findByText("A few questions about you");
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ yourName: "Mei Chen" }),
  );
  blank.unmount();
  render(<GuidedOnboarding {...props} initialName="Jo Park" />);
  expect(screen.getByLabelText<HTMLInputElement>("Your name").value).toBe(
    "Jo Park",
  );
});
