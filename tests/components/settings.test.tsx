import { render, screen } from "@testing-library/react";
import { Button } from "~/components/ui/button";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import {
  SettingRow,
  SettingsPage,
  SettingsSection,
} from "~/components/ui/settings";
import { Switch } from "~/components/ui/switch";

test("a section is named by its heading, or by its label when it has none", () => {
  render(
    <SettingsPage>
      <SettingsSection heading="Account">Email address</SettingsSection>
      <SettingsSection aria-label="Timezone">Timezone</SettingsSection>
    </SettingsPage>,
  );
  expect(screen.getByRole("region", { name: "Account" }).textContent).toContain(
    "Email address",
  );
  expect(screen.getByRole("heading", { name: "Account" })).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Timezone" }).textContent,
  ).toContain("Timezone");
});

test("a row's label names its switch, and its description describes it", () => {
  render(
    <SettingsSection aria-label="Daily review email">
      <SettingRow
        label="Send the daily review"
        description="Your budget keeps working when this is off."
      >
        <Switch checked onCheckedChange={() => undefined} />
      </SettingRow>
    </SettingsSection>,
  );
  const control = screen.getByRole("switch", {
    name: "Send the daily review",
    description: "Your budget keeps working when this is off.",
  });
  expect(control.getAttribute("aria-checked")).toBe("true");
});

test("clicking a row's label or description leaves its switch alone", async () => {
  const change = vi.fn();
  const user = userEvent.setup();
  render(
    <SettingsSection aria-label="Daily review email">
      <SettingRow
        label="Send the daily review"
        description="Your budget keeps working when this is off."
      >
        <Switch checked={false} onCheckedChange={change} />
      </SettingRow>
    </SettingsSection>,
  );
  await user.click(screen.getByText("Send the daily review"));
  await user.click(screen.getByText(/keeps working/));
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole("switch"));
  expect(change).toHaveBeenCalledWith(true);
});

test("a row announces an action that failed", async () => {
  const { rerender } = render(
    <SettingsSection aria-label="Profile">
      <SettingRow label="Profile picture">
        <Button>Remove</Button>
      </SettingRow>
    </SettingsSection>,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  rerender(
    <SettingsSection aria-label="Profile">
      <SettingRow
        label="Profile picture"
        error="Your photo couldn’t be removed. Try again."
      >
        <Button>Remove</Button>
      </SettingRow>
    </SettingsSection>,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Your photo couldn’t be removed. Try again.",
  );
});

test("a row shows what opens under it", () => {
  render(
    <SettingsSection heading="Account">
      <SettingRow
        label="Password"
        description="Add a password to sign in without a connected account."
        below={
          <form aria-label="Add a password">
            <Button type="submit">Add password</Button>
          </form>
        }
      />
    </SettingsSection>,
  );
  const form = screen.getByRole("form", { name: "Add a password" });
  expect(form.textContent).toBe("Add password");
});
