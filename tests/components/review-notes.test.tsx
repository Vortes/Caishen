import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import {
  ItemNotes,
  ReviewNotesBar,
  ReviewNotesProvider,
} from "~/components/prototype/review-notes";

test("copies the overall notes and each item's review as Markdown", async () => {
  const user = userEvent.setup();
  render(
    <ReviewNotesProvider
      storageKey="batch-1"
      title="Batch 1: account and entry"
    >
      <ReviewNotesBar />
      <ItemNotes id="welcome" title="Welcome" />
      <ItemNotes id="onboarding" title="Onboarding" />
      <ItemNotes id="unsubscribe" title="Unsubscribe" />
    </ReviewNotesProvider>,
  );

  await user.type(
    screen.getByRole("textbox", { name: "Overall thoughts" }),
    "Close to done.",
  );
  const welcome = screen.getByRole("group", { name: "Review of Welcome" });
  await user.click(within(welcome).getByRole("switch", { name: "Looks good" }));
  const onboarding = screen.getByRole("group", {
    name: "Review of Onboarding",
  });
  await user.type(
    within(onboarding).getByRole("textbox", { name: "Notes" }),
    "Steps feel long.{Enter}Drop the timezone step.",
  );

  expect(screen.getByText("1 of 3 look good")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Copy as Markdown" }));

  expect(await navigator.clipboard.readText()).toBe(
    [
      "# Batch 1: account and entry review",
      "",
      "Close to done.",
      "",
      "- **Welcome**: Looks good",
      "- **Onboarding**: Needs review",
      "  > Steps feel long.",
      "  > Drop the timezone step.",
      "- **Unsubscribe**: Needs review, no comments",
      "",
    ].join("\n"),
  );
});
