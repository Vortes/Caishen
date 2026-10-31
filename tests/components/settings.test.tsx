import { render, screen } from "@testing-library/react";
import { Button } from "~/components/ui/button";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import {
  SettingRow,
  SettingsPage,
  SettingsSection,
} from "~/components/ui/settings";
import { Select } from "~/components/ui/select";
import { SurfaceProvider } from "~/components/ui/surface";
import { Switch } from "~/components/ui/switch";
import { TextInput } from "~/components/ui/text-input";

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

test("a row's label names its text input, and its description describes it", () => {
  render(
    <SettingsSection aria-label="Profile">
      <SettingRow
        label="Budget name"
        description="Shown at the top of the sidebar."
      >
        <TextInput value="Home" onChange={() => undefined} />
      </SettingRow>
    </SettingsSection>,
  );
  const input = screen.getByRole("textbox", {
    name: "Budget name",
    description: "Shown at the top of the sidebar.",
  });
  expect((input as HTMLInputElement).value).toBe("Home");
});

const hours = [
  { value: "7", label: "7 a.m." },
  { value: "8", label: "8 a.m." },
];

function SendAt({ onChange = () => undefined }: { onChange?: () => void }) {
  return (
    <SurfaceProvider container={document.body}>
      <SettingsSection heading="Daily review email">
        <SettingRow label="Send at" description="New York time.">
          <Select value="7" onChange={onChange} options={hours} />
        </SettingRow>
      </SettingsSection>
    </SurfaceProvider>
  );
}

test("a row's label names its select, and its description describes it", () => {
  render(<SendAt />);
  const select = screen.getByRole("combobox", {
    name: "Send at",
    description: "New York time.",
  });
  expect(select.textContent).toBe("7 a.m.");
});

test("clicking a row's label or description leaves its select closed", async () => {
  const user = userEvent.setup();
  render(<SendAt />);
  const select = screen.getByRole("combobox", { name: "Send at" });
  // Each click is checked on its own: a click elsewhere closes an open list.
  await user.click(screen.getByText("Send at"));
  expect(select.getAttribute("aria-expanded")).toBe("false");
  await user.click(screen.getByText("New York time."));
  expect(select.getAttribute("aria-expanded")).toBe("false");
  await user.click(select);
  expect(screen.getByRole("listbox", { name: "Send at" })).toBeTruthy();
});

test("a field error in a row describes its input and marks it invalid, without announcing it", () => {
  render(
    <SettingsSection aria-label="Profile">
      <SettingRow
        label="Budget name"
        description="Shown at the top of the sidebar."
        fieldError="Use 120 characters or fewer."
      >
        <TextInput value="Home" onChange={() => undefined} />
      </SettingRow>
    </SettingsSection>,
  );
  const input = screen.getByRole("textbox", {
    name: "Budget name",
    description:
      "Shown at the top of the sidebar. Use 120 characters or fewer.",
  });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
