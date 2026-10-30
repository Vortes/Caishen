import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { ConfirmDialog, Dialog } from "~/components/ui/dialog";
import { SurfaceProvider } from "~/components/ui/surface";
import surface from "~/components/ui/surface.module.css";

// The themed root the shell passes to the provider.
function themedRoot() {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

test("a dialog renders its scrim and content in the provider's container", () => {
  const root = themedRoot();
  render(
    <SurfaceProvider container={root}>
      <Dialog label="Crop your photo" open onOpenChange={() => undefined}>
        <p>Photo</p>
      </Dialog>
    </SurfaceProvider>,
  );

  const dialog = screen.getByRole("dialog", { name: "Crop your photo" });
  expect(root.contains(dialog)).toBe(true);
  expect(root.querySelector(`.${surface.scrim}`)).not.toBeNull();
});

// A disconnect while the server is still working on it.
function Pending() {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Disconnect from Sam?"
      description="You'll each keep a budget of your own."
      cancel="Cancel"
      confirm="Disconnecting…"
      tone="danger"
      onConfirm={() => undefined}
      pending
    />
  );
}

test("a pending confirm dialog disables both buttons and refuses to close", async () => {
  const user = userEvent.setup();
  const root = themedRoot();
  render(
    <SurfaceProvider container={root}>
      <Pending />
    </SurfaceProvider>,
  );

  const dialog = screen.getByRole("alertdialog", {
    name: "Disconnect from Sam?",
  });
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "Disconnecting…" })).toHaveProperty(
    "disabled",
    true,
  );

  await user.keyboard("{Escape}");
  await user.click(root.querySelector<HTMLElement>(`.${surface.scrim}`)!);
  expect(dialog.isConnected).toBe(true);
  expect(
    screen.getByRole("alertdialog", { name: "Disconnect from Sam?" }),
  ).toBe(dialog);
});

test("a confirm dialog shows its error as an alert", () => {
  render(
    <SurfaceProvider container={themedRoot()}>
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Disconnect Chase?"
        description="Bank updates will stop."
        cancel="Cancel"
        confirm="Disconnect"
        tone="danger"
        onConfirm={() => undefined}
        error="Your bank couldn’t be disconnected. Try again."
      />
    </SurfaceProvider>,
  );

  const dialog = screen.getByRole("alertdialog", { name: "Disconnect Chase?" });
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Your bank couldn’t be disconnected. Try again.",
  );
});

// A dialog the pointer opens, as after Plaid's window or a menu item.
function Opener({ continued }: { continued?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        label="Connecting your bank"
        open={open}
        onOpenChange={setOpen}
        continued={continued}
      >
        <p>Progress</p>
      </Dialog>
    </>
  );
}

test.each([
  [false, false],
  [true, true],
])(
  "a continued dialog (%s) lands on the scrim without fading it in",
  async (continued, instant) => {
    const user = userEvent.setup();
    const root = themedRoot();
    render(
      <SurfaceProvider container={root}>
        <Opener continued={continued} />
      </SurfaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    const scrim = root.querySelector<HTMLElement>(`.${surface.scrim}`)!;
    expect(scrim.dataset.motion).toBe("occasional");
    expect(scrim.hasAttribute("data-instant")).toBe(instant);
  },
);

test("a dialog without auto-focus focuses itself rather than its first control", () => {
  render(
    <SurfaceProvider container={themedRoot()}>
      <Dialog
        label="Crop your photo"
        open
        onOpenChange={() => undefined}
        autoFocus={false}
      >
        <button>Cancel</button>
      </Dialog>
    </SurfaceProvider>,
  );

  expect(document.activeElement).toBe(
    screen.getByRole("dialog", { name: "Crop your photo" }),
  );
});
