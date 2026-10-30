import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
} from "~/components/ui/menu";
import { SurfaceProvider } from "~/components/ui/surface";

// The themed root the shell passes to the provider.
function themedRoot() {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

test("an item runs its action and closes the menu", async () => {
  const user = userEvent.setup();
  const logOut = vi.fn();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Menu label="Profile" trigger={<button>Household</button>}>
        <MenuItem title="Log out" onSelect={logOut} />
      </Menu>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Household" }));
  await user.click(screen.getByRole("menuitem", { name: "Log out" }));

  expect(logOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu", { name: "Profile" })).toBeNull();
});

test("a link item navigates to its href", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Menu label="Profile" trigger={<button>Household</button>}>
        <MenuItem
          title="Settings"
          href="/settings/profile"
          onNavigate={navigate}
        />
      </Menu>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Household" }));
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));

  expect(navigate).toHaveBeenCalledExactlyOnceWith("/settings/profile");
  expect(screen.queryByRole("menu", { name: "Profile" })).toBeNull();
});

// Refuses the change it is asked for, as Categorize does when a row is gone.
function RefusingMenu() {
  const [error, setError] = useState("");
  return (
    <Menu
      label="Categorize transactions"
      trigger={<button>Categorize</button>}
      error={error}
    >
      <MenuItem
        title="Groceries"
        onSelect={(event) => {
          event.preventDefault();
          setError("Two transactions changed elsewhere.");
        }}
      />
    </Menu>
  );
}

test("an item that prevents the default keeps the menu open and shows the error line", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <RefusingMenu />
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Categorize" }));
  await user.click(screen.getByRole("menuitem", { name: "Groceries" }));

  const menu = screen.getByRole("menu", { name: "Categorize transactions" });
  expect(within(menu).getByRole("alert").textContent).toBe(
    "Two transactions changed elsewhere.",
  );
});

function BehaviorMenu() {
  const [behavior, setBehavior] = useState("refill");
  return (
    <Menu label="When the target is met" trigger={<button>Behavior</button>}>
      <MenuRadioGroup value={behavior} onValueChange={setBehavior}>
        <MenuRadioItem value="refill" title="Refill up to" />
        <MenuRadioItem
          value="another"
          title="Set aside another"
          detail="Use for: savings"
        />
      </MenuRadioGroup>
    </Menu>
  );
}

test("a radio item marks the current choice", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <BehaviorMenu />
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Behavior" }));
  expect(
    screen
      .getAllByRole("menuitemradio", { checked: true })
      .map((item) => item.textContent),
  ).toEqual(["Refill up to"]);
  await user.click(
    screen.getByRole("menuitemradio", { name: /Set aside another/ }),
  );
  await user.click(screen.getByRole("button", { name: "Behavior" }));

  expect(
    screen.getByRole("menuitemradio", { checked: true }).textContent,
  ).toContain("Set aside another");
});

test("a submenu opens from its item", async () => {
  const user = userEvent.setup();
  const categorize = vi.fn();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Menu
        label="Categorize transactions"
        trigger={<button>Categorize</button>}
      >
        <MenuSub title="Everyday" label="Everyday categories">
          <MenuItem title="Groceries" onSelect={categorize} />
        </MenuSub>
      </Menu>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Categorize" }));
  await user.click(screen.getByRole("menuitem", { name: "Everyday" }));
  const submenu = screen.getByRole("menu", { name: "Everyday categories" });
  expect(
    within(submenu).getByRole("menuitem", { name: "Groceries" }),
  ).toBeTruthy();
  // jsdom has no layout for Radix's pointer grace area, so choose by keyboard.
  await user.keyboard("{ArrowRight}{Enter}");

  expect(categorize).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("menu", { name: "Categorize transactions" }),
  ).toBeNull();
});

test("arrow keys move the highlight, past a separator and a disabled item", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Menu label="Chase options" trigger={<button>Options</button>}>
        <MenuItem title="Add 2 accounts" onSelect={() => undefined} />
        <MenuItem
          title="Choose shared accounts"
          disabled
          onSelect={() => undefined}
        />
        <MenuSeparator />
        <MenuItem title="Disconnect…" onSelect={() => undefined} />
      </Menu>
    </SurfaceProvider>,
  );

  screen.getByRole("button", { name: "Options" }).focus();
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Add 2 accounts" }),
  );
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Disconnect…" }),
  );
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Add 2 accounts" }),
  );
});
