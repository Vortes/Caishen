import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { Field, FormError, FormFooter } from "~/components/ui/field";
import { TextInput } from "~/components/ui/text-input";

function Memo({ hint, error }: { hint?: string; error?: string }) {
  const [value, setValue] = useState("");
  return (
    <Field label="Memo" hint={hint} error={error}>
      <TextInput value={value} onChange={setValue} />
    </Field>
  );
}

test("the label names the input, and clicking it leaves the input alone", async () => {
  const user = userEvent.setup();
  render(<Memo />);

  await user.click(screen.getByText("Memo"));

  expect(document.activeElement).not.toBe(
    screen.getByRole("textbox", { name: "Memo" }),
  );
});

test("the hint and the error describe the input, and the error marks it invalid", () => {
  render(
    <Memo hint="Shown on the statement." error="Keep it under 200 letters." />,
  );

  const input = screen.getByRole("textbox", {
    name: "Memo",
    description: "Keep it under 200 letters. Shown on the statement.",
  });
  expect(input.getAttribute("aria-invalid")).toBe("true");
});

test("a field's error waits to be read at the field; it is not announced", () => {
  render(<Memo error="Keep it under 200 letters." />);

  expect(screen.getByText("Keep it under 200 letters.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

test("the form's error is announced as it appears", () => {
  render(<FormError>You’re offline. Try again in a moment.</FormError>);

  expect(screen.getByRole("alert").textContent).toBe(
    "You’re offline. Try again in a moment.",
  );
});

test("the input sends its name and value with its form", async () => {
  const user = userEvent.setup();
  let sent: FormData | undefined;
  function Payee() {
    const [value, setValue] = useState("");
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sent = new FormData(event.currentTarget);
        }}
      >
        <Field label="Payee">
          <TextInput name="payee" value={value} onChange={setValue} />
        </Field>
        <button type="submit">Save</button>
      </form>
    );
  }
  render(<Payee />);

  await user.type(
    screen.getByRole("textbox", { name: "Payee" }),
    "Corner shop",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(sent?.get("payee")).toBe("Corner shop");
});

test("text before and after the value shows in the well and leaves the name alone", () => {
  render(
    <Field label="Interest rate">
      <TextInput
        value="6.5"
        onChange={() => undefined}
        prefix="APR"
        suffix="%"
        inputMode="decimal"
        placeholder="0"
      />
    </Field>,
  );

  const input = screen.getByRole("textbox", { name: "Interest rate" });
  expect(input.getAttribute("inputmode")).toBe("decimal");
  expect(input.getAttribute("placeholder")).toBe("0");
  expect(screen.getByText("APR")).toBeTruthy();
  expect(screen.getByText("%")).toBeTruthy();
});

test("a control that isn't a ui input names its field by the field's id", () => {
  render(
    <Field id="due" label="Due on" error="Choose a date in October or later.">
      <input id="due" aria-describedby="due-error" />
    </Field>,
  );

  expect(
    screen.getByRole("textbox", {
      name: "Due on",
      description: "Choose a date in October or later.",
    }),
  ).toBeTruthy();
});

test("the footer holds the form's note and its actions", () => {
  render(
    <form aria-label="Move money">
      <FormFooter actions={<button type="submit">Move</button>}>
        Moves happen right away.
      </FormFooter>
    </form>,
  );

  const form = screen.getByRole("form", { name: "Move money" });
  expect(within(form).getByText("Moves happen right away.")).toBeTruthy();
  expect(within(form).getByRole("button", { name: "Move" })).toBeTruthy();
});

test("one error shown for two fields marks both invalid and describes both", () => {
  render(
    <>
      <Field label="Outflow" sharedErrorId="amount-error">
        <TextInput value="" onChange={() => undefined} />
      </Field>
      <Field label="Inflow" sharedErrorId="amount-error">
        <TextInput value="" onChange={() => undefined} />
      </Field>
      <p id="amount-error">Enter an outflow or an inflow.</p>
    </>,
  );

  for (const name of ["Outflow", "Inflow"]) {
    const input = screen.getByRole("textbox", {
      name,
      description: "Enter an outflow or an inflow.",
    });
    expect(input.getAttribute("aria-invalid")).toBe("true");
  }
});

test("a password input hides what's typed and tells password managers what it holds", async () => {
  const user = userEvent.setup();
  function NewPassword() {
    const [value, setValue] = useState("");
    return (
      <Field label="New password">
        <TextInput
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={setValue}
        />
      </Field>
    );
  }
  render(<NewPassword />);

  const input = screen.getByLabelText<HTMLInputElement>("New password");
  await user.type(input, "hunter22");

  expect(input.value).toBe("hunter22");
  expect(input.type).toBe("password");
  expect(input.autocomplete).toBe("new-password");
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("the browser may fill a field that asks for it, and no other", () => {
  render(
    <>
      <Field label="Your name">
        <TextInput autoComplete="name" value="" onChange={() => undefined} />
      </Field>
      <Field label="Category">
        <TextInput value="" onChange={() => undefined} />
      </Field>
    </>,
  );

  const name = screen.getByRole("textbox", { name: "Your name" });
  const category = screen.getByRole("textbox", { name: "Category" });
  expect(name.getAttribute("autocomplete")).toBe("name");
  expect(name.hasAttribute("data-1p-ignore")).toBe(false);
  expect(category.getAttribute("autocomplete")).toBe("off");
  expect(category.hasAttribute("data-1p-ignore")).toBe(true);
});

test("a required field left empty keeps its form from being sent", async () => {
  const user = userEvent.setup();
  let sent = 0;
  function Account() {
    const [value, setValue] = useState("");
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sent += 1;
        }}
      >
        <Field label="Account name">
          <TextInput required value={value} onChange={setValue} />
        </Field>
        <button type="submit">Add</button>
      </form>
    );
  }
  render(<Account />);

  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(sent).toBe(0);

  await user.type(
    screen.getByRole("textbox", { name: "Account name" }),
    "Checking",
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(sent).toBe(1);
});
