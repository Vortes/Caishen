import type { Locator } from "@playwright/test";
import { expect, test, shellPath } from "./shell-fixture";

// Each surface opens from its trigger under its own name, closes on Escape,
// and gives focus back to the trigger.
async function escapesToTrigger(trigger: Locator, surface: Locator) {
  await expect(surface).toBeVisible();
  await surface.page().keyboard.press("Escape");
  await expect(surface).toBeHidden();
  await expect(trigger).toBeFocused();
}

test("the month picker, profile menu, and Discard confirm return focus to their trigger", async ({
  page,
  budget,
}) => {
  const picker = page.getByRole("button", { name: /, choose a month$/ });
  await picker.click();
  await escapesToTrigger(
    picker,
    page.getByRole("dialog", { name: "Choose a month", exact: true }),
  );

  const profile = page.getByRole("button", { name: budget.name, exact: true });
  await profile.click();
  await escapesToTrigger(
    profile,
    page.getByRole("menu", { name: budget.name, exact: true }),
  );

  // Cancel asks before discarding a signed invitation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${shellPath}/settings/people`);
  await page.getByLabel("Their email").fill("partner@caishen.example");
  await page.getByRole("button", { name: "Write invitation" }).click();
  await page.getByRole("button", { name: "Turn over to sign" }).click();
  await page.getByRole("button", { name: "Sign with my name instead" }).click();
  await page.getByRole("button", { name: "Change paper" }).click();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await cancel.click();
  await escapesToTrigger(
    cancel,
    page.getByRole("alertdialog", {
      name: "Discard this invitation?",
      exact: true,
    }),
  );
  // Escape answers Keep writing: the signed card is still there.
  await expect(
    page.getByRole("button", { name: "Turn over to sign" }),
  ).toBeVisible();
});
