import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ProfilePreferences } from "~/components/entry/profile-preferences";
import { SurfaceProvider } from "~/components/ui/surface";

test("an email setting refused by the budget stays unchanged and explains why", async () => {
  const change = vi.fn(() => "Wait for your budget to reconnect.");
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={document.body}>
      <ProfilePreferences
        value={{
          timezone: "America/New_York",
          emailEnabled: true,
          emailHour: 8,
        }}
        onChange={change}
      />
    </SurfaceProvider>,
  );
  await user.click(
    screen.getByRole("switch", { name: "Send the daily review" }),
  );
  expect(change).toHaveBeenCalledWith({ emailEnabled: false });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Wait for your budget to reconnect",
  );
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
});
