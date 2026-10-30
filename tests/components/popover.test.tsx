import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { expect, test } from "vitest";
import { Popover } from "~/components/ui/popover";
import { SurfaceProvider } from "~/components/ui/surface";
import surface from "~/components/ui/surface.module.css";
import { Tooltip } from "~/components/ui/tooltip";

// The themed root the shell passes to the provider.
function themedRoot() {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

test("a popover renders its content in the provider's container", async () => {
  const user = userEvent.setup();
  const root = themedRoot();
  render(
    <SurfaceProvider container={root}>
      <Popover label="Choose a month" trigger={<button>March</button>}>
        <p>Months</p>
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "March" }));

  const popover = screen.getByRole("dialog", { name: "Choose a month" });
  expect(root.contains(popover)).toBe(true);
});

test("a frequent popover opens instantly; an occasional one animates only when the pointer opens it", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Popover label="Move money" trigger={<button>Move</button>}>
        <p>Form</p>
      </Popover>
      <Popover
        label="Banks"
        trigger={<button>Banks</button>}
        motion="occasional"
      >
        <p>Banks</p>
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Move" }));
  const frequent = screen.getByRole("dialog", { name: "Move money" });
  expect(frequent.dataset.motion).toBe("frequent");
  expect(frequent.dataset.instant).toBeDefined();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "Banks" }));
  const pointer = screen.getByRole("dialog", { name: "Banks" });
  expect(pointer.dataset.motion).toBe("occasional");
  expect(pointer.dataset.instant).toBeUndefined();
  await user.keyboard("{Escape}");

  screen.getByRole("button", { name: "Banks" }).focus();
  await user.keyboard("{Enter}");
  const keyboard = screen.getByRole("dialog", { name: "Banks" });
  expect(keyboard.dataset.motion).toBe("occasional");
  expect(keyboard.dataset.instant).toBeDefined();
});

test.each(["form", "wide", "trigger"] as const)(
  "a %s popover renders its width",
  async (size) => {
    const user = userEvent.setup();
    render(
      <SurfaceProvider container={themedRoot()}>
        <Popover label="Panel" trigger={<button>Open</button>} size={size}>
          <p>Content</p>
        </Popover>
      </SurfaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const popover = screen.getByRole("dialog", { name: "Panel" });
    const widths = (["form", "wide", "trigger"] as const).filter((width) =>
      popover.classList.contains(surface[width]!),
    );
    expect(widths).toEqual([size]);
  },
);

// A field whose list opens as it is typed in, as a combobox does.
function TypedField() {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label="Payees"
      anchor={<input aria-label="Payee" onChange={() => setOpen(true)} />}
      open={open}
      onOpenChange={setOpen}
    >
      <button type="button">Market</button>
    </Popover>
  );
}

test("an anchor popover leaves focus in the input", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <TypedField />
    </SurfaceProvider>,
  );

  await user.type(screen.getByRole("textbox", { name: "Payee" }), "Ma");

  expect(screen.getByRole("dialog", { name: "Payees" })).toBeDefined();
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Payee" }),
  );
});

test("a popover with autoFocus off moves no focus until its content puts it somewhere", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Popover
        label="Choose a month"
        trigger={<button>March</button>}
        autoFocus={false}
      >
        <button type="button">Previous year</button>
        <button type="button">March 2026</button>
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "March" }));

  expect(screen.getByRole("dialog", { name: "Choose a month" })).toBeDefined();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "March" }),
  );
});

test("Escape closes an open list inside a popover before the popover", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Popover label="Move money" trigger={<button>Move</button>}>
        <ListField />
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Move" }));
  await user.click(screen.getByRole("combobox", { name: "To" }));
  await user.keyboard("{Escape}");

  expect(screen.getByRole("dialog", { name: "Move money" })).toBeDefined();
  expect(
    screen.getByRole("combobox", { name: "To" }).getAttribute("aria-expanded"),
  ).toBe("false");

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog", { name: "Move money" })).toBeNull();
});

// A combobox whose list opens on focus and closes on Escape.
function ListField() {
  const [expanded, setExpanded] = useState(false);
  return (
    <input
      role="combobox"
      aria-label="To"
      aria-controls="to-list"
      aria-expanded={expanded}
      onFocus={() => setExpanded(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setExpanded(false);
      }}
    />
  );
}

test("a trigger popover can hang from a separate anchor and still opens from its trigger", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <div>
        <Popover
          label="Share selected transactions"
          trigger={<button>Share</button>}
          anchor={<span />}
        >
          <button type="button">With partner</button>
        </Popover>
      </div>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Share" }));

  expect(
    screen.getByRole("dialog", { name: "Share selected transactions" }),
  ).toBeDefined();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "With partner" }),
  );
});

test("a trigger with a tooltip opens the popover", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Popover
        label="Add a category group"
        trigger={
          <Tooltip label="Add a category group" shortcut="N">
            <button>Add group</button>
          </Tooltip>
        }
      >
        <input aria-label="Name" />
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Add group" }));

  expect(
    screen.getByRole("dialog", { name: "Add a category group" }),
  ).toBeDefined();
});

// Adds a group, then focuses what it added rather than its own button.
function AddGroup() {
  const [open, setOpen] = useState(false);
  const added = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Popover
        label="Add a category group"
        trigger={<button>Add group</button>}
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          added.current?.focus();
        }}
      >
        <button type="button" onClick={() => setOpen(false)}>
          Save
        </button>
      </Popover>
      <button ref={added}>Bills</button>
    </>
  );
}

test("a popover can send focus somewhere other than its trigger as it closes", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <AddGroup />
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Add group" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Bills" }),
    ),
  );
});

test("a popover draws an arrow toward its trigger only when asked", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={themedRoot()}>
      <Popover label="Reconcile" trigger={<button>Reconcile</button>} arrow>
        <p>Balances</p>
      </Popover>
      <Popover label="Filters" trigger={<button>Filters</button>}>
        <p>Categories</p>
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Reconcile" }));
  const pointed = screen.getByRole("dialog", { name: "Reconcile" });
  expect(pointed.querySelector(`.${surface.arrow}`)).not.toBeNull();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "Filters" }));
  const plain = screen.getByRole("dialog", { name: "Filters" });
  expect(plain.querySelector(`.${surface.arrow}`)).toBeNull();
});
