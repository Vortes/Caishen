import { expect, test } from "./shell-fixture";
import { fillPurchase, openRegister } from "./shell-controls";

// A touch screen, so the amount field's operator row shows.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("on a phone, the operator row splits a receipt in a register line's outflow", async ({
  page,
  budget,
}) => {
  await openRegister(page, budget.account);
  const panelWidths = page.getByRole("button", {
    name: "Panel widths",
    exact: true,
    expanded: true,
  });
  if (await panelWidths.isVisible()) await panelWidths.click();
  const form = await fillPurchase(page, budget, "Dinner for three", "84.20");
  const outflow = form.getByLabel("Outflow", { exact: true });
  await expect(outflow).toBeFocused();

  await page.getByRole("button", { name: "Divide by", exact: true }).tap();
  await expect(outflow).toBeFocused();
  await page.keyboard.type("3");
  await expect(outflow).toHaveValue("84.20÷3");
  await outflow.blur();

  await expect(outflow).toHaveValue("28.07");
});
