import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { Popover } from "~/components/ui/popover";
import { SurfaceProvider } from "~/components/ui/surface";
import surface from "~/components/ui/surface.module.css";

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
