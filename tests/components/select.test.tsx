import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { expect, test } from "vitest";
import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Select } from "~/components/ui/select";
import { SurfaceProvider } from "~/components/ui/surface";

const kinds = [
  { value: "cash", label: "Cash / checking / savings" },
  { value: "credit", label: "Credit card" },
  { value: "tracking", label: "Tracking / brokerage" },
];

function AccountType({ error }: { error?: string }) {
  const [value, setValue] = useState("cash");
  return (
    <SurfaceProvider container={document.body}>
      <Field label="Account type" error={error}>
        <Select value={value} onChange={setValue} options={kinds} />
      </Field>
      <output role="status">{value}</output>
    </SurfaceProvider>
  );
}

test("the field's label names the select, and its trigger opens the list", async () => {
  const user = userEvent.setup();
  render(<AccountType />);

  await user.click(screen.getByRole("combobox", { name: "Account type" }));

  const list = screen.getByRole("listbox", { name: "Account type" });
  expect(
    within(list)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual([
    "Cash / checking / savings",
    "Credit card",
    "Tracking / brokerage",
  ]);
});

test("the arrow keys move through the list from the current choice, and Enter picks", async () => {
  const user = userEvent.setup();
  render(<AccountType />);

  await user.click(screen.getByRole("combobox", { name: "Account type" }));
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}");

  expect(screen.getByRole("status").textContent).toBe("tracking");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(
    screen.getByRole("combobox", { name: "Account type" }).textContent,
  ).toBe("Tracking / brokerage");
});

test("typing jumps to the option that starts with it, and Home and End reach the ends", async () => {
  const user = userEvent.setup();
  render(<AccountType />);

  await user.click(screen.getByRole("combobox", { name: "Account type" }));
  await user.keyboard("tr");
  expect(document.activeElement?.textContent).toBe("Tracking / brokerage");
  await user.keyboard("{Home}");
  expect(document.activeElement?.textContent).toBe("Cash / checking / savings");
  await user.keyboard("{End}");
  expect(document.activeElement?.textContent).toBe("Tracking / brokerage");
  await user.keyboard("{Home}c");
  expect(document.activeElement?.textContent).toBe("Credit card");
  await user.keyboard("{Enter}");

  expect(screen.getByRole("status").textContent).toBe("credit");
});

test("a click on an option picks it", async () => {
  const user = userEvent.setup();
  render(<AccountType />);

  await user.click(screen.getByRole("combobox", { name: "Account type" }));
  await user.click(screen.getByRole("option", { name: "Credit card" }));

  expect(screen.getByRole("status").textContent).toBe("credit");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("Escape closes the list without picking, and focus returns to the select", async () => {
  const user = userEvent.setup();
  render(<AccountType />);
  const select = screen.getByRole("combobox", { name: "Account type" });

  await user.click(select);
  await user.keyboard("{ArrowDown}{Escape}");

  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("cash");
  expect(document.activeElement).toBe(select);
});

test("from the keyboard alone, the down arrow opens the list and a pick returns focus to the select", async () => {
  const user = userEvent.setup();
  render(<AccountType />);

  await user.tab();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("listbox", { name: "Account type" })).toBeTruthy();
  await user.keyboard("{ArrowDown}{Enter}");

  expect(screen.getByRole("status").textContent).toBe("credit");
  expect(document.activeElement).toBe(
    screen.getByRole("combobox", { name: "Account type" }),
  );
});

test("the select sends its name and current value with its form", async () => {
  const user = userEvent.setup();
  let sent: FormData | undefined;
  function NewAccount() {
    const [value, setValue] = useState("cash");
    return (
      <SurfaceProvider container={document.body}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sent = new FormData(event.currentTarget);
          }}
        >
          <Field label="Account type">
            <Select
              name="kind"
              value={value}
              onChange={setValue}
              options={kinds}
            />
          </Field>
          <button type="submit">Add account</button>
        </form>
      </SurfaceProvider>
    );
  }
  render(<NewAccount />);

  await user.click(screen.getByRole("combobox", { name: "Account type" }));
  await user.click(
    screen.getByRole("option", { name: "Tracking / brokerage" }),
  );
  await user.click(screen.getByRole("button", { name: "Add account" }));

  expect(sent?.get("kind")).toBe("tracking");
});

test("the field's error describes the select and marks it invalid", () => {
  render(<AccountType error="Choose what kind of account this is." />);

  const select = screen.getByRole("combobox", {
    name: "Account type",
    description: "Choose what kind of account this is.",
  });
  expect(select.getAttribute("aria-invalid")).toBe("true");
});

test("until something is chosen the select shows its placeholder, and the list starts at the first option", async () => {
  const user = userEvent.setup();
  function LinkTo() {
    const [value, setValue] = useState("");
    return (
      <SurfaceProvider container={document.body}>
        <Field label="Link to">
          <Select
            value={value}
            onChange={setValue}
            options={[
              { value: "checking", label: "Checking" },
              { value: "savings", label: "Savings" },
            ]}
            placeholder="Choose an existing account"
          />
        </Field>
      </SurfaceProvider>
    );
  }
  render(<LinkTo />);
  const select = screen.getByRole("combobox", { name: "Link to" });
  expect(select.textContent).toBe("Choose an existing account");

  await user.click(select);
  await user.keyboard("{Enter}");

  expect(select.textContent).toBe("Checking");
});

test("a disabled select doesn't open", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={document.body}>
      <Field label="Account type">
        <Select
          value="cash"
          onChange={() => undefined}
          options={kinds}
          disabled
        />
      </Field>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("combobox", { name: "Account type" }));

  expect(screen.queryByRole("listbox")).toBeNull();
});

test("inside a dialog, the keyboard still moves through the list and picks", async () => {
  const user = userEvent.setup();
  function LinkTo() {
    const [value, setValue] = useState("cash");
    return (
      <SurfaceProvider container={document.body}>
        <Dialog label="Discover accounts" open onOpenChange={() => undefined}>
          <Field label="Account type">
            <Select value={value} onChange={setValue} options={kinds} />
          </Field>
          <output role="status">{value}</output>
        </Dialog>
      </SurfaceProvider>
    );
  }
  render(<LinkTo />);

  await user.click(screen.getByRole("combobox", { name: "Account type" }));
  await user.keyboard("{ArrowDown}{Enter}");

  expect(screen.getByRole("status").textContent).toBe("credit");
  expect(
    screen.getByRole("dialog", { name: "Discover accounts" }),
  ).toBeTruthy();
});

test("the input ref reaches the select, so a form can focus it after a failed save", () => {
  const ref = createRef<HTMLButtonElement>();
  render(
    <SurfaceProvider container={document.body}>
      <Field label="Due on">
        <Select
          value="03"
          onChange={() => undefined}
          options={[{ value: "03", label: "March" }]}
          inputRef={ref}
        />
      </Field>
    </SurfaceProvider>,
  );

  ref.current?.focus();

  expect(document.activeElement).toBe(
    screen.getByRole("combobox", { name: "Due on" }),
  );
});
