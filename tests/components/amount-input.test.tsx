import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { expect, test, vi } from "vitest";
import { AmountInput } from "~/components/ui/amount-input";
import { Field } from "~/components/ui/field";

function Amount({ initial = "", error }: { initial?: string; error?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <Field label="Amount" error={error}>
        <AmountInput name="amount" value={value} onChange={setValue} />
      </Field>
      <button type="button">Next</button>
    </form>
  );
}

function amount() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" });
}

test("thousands separators appear as you type", async () => {
  const user = userEvent.setup();
  render(<Amount />);

  await user.type(amount(), "1234567.5");

  expect(amount().value).toBe("1,234,567.5");
});

test("the caret stays after the digit you typed as the separators move", async () => {
  const user = userEvent.setup();
  render(<Amount initial="123,456" />);

  // Between the 1 and the 2.
  await user.type(amount(), "9", {
    initialSelectionStart: 1,
    initialSelectionEnd: 1,
  });

  expect(amount().value).toBe("1,923,456");
  expect(amount().selectionStart).toBe(3);
  await user.keyboard("8");
  expect(amount().value).toBe("19,823,456");
});

test("leaving the field replaces a calculation with its result", async () => {
  const user = userEvent.setup();
  render(<Amount />);

  await user.type(amount(), "1200/12");
  await user.tab();
  expect(amount().value).toBe("100.00");

  await user.clear(amount());
  await user.type(amount(), "(600+1000)*2");
  await user.tab();
  expect(amount().value).toBe("3,200.00");
});

test("leaving unreadable text keeps it and says what an amount looks like", async () => {
  const user = userEvent.setup();
  render(<Amount />);

  await user.click(amount());
  await user.tab();
  expect(amount().getAttribute("aria-invalid")).toBeNull();

  await user.type(amount(), "12+");
  await user.tab();

  const field = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Amount",
    description: "Enter an amount, such as 84.20 or 600+150.",
  });
  expect(field.value).toBe("12+");
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the message stays while the text is still unreadable and goes once it reads", async () => {
  const user = userEvent.setup();
  render(<Amount />);
  await user.type(amount(), "12++");
  await user.tab();

  await user.type(amount(), "{Backspace}", {
    initialSelectionStart: 4,
    initialSelectionEnd: 4,
  });
  expect(amount().getAttribute("aria-invalid")).toBe("true");
  await user.keyboard("3");

  expect(amount().value).toBe("12+3");
  expect(amount().getAttribute("aria-invalid")).toBeNull();
  expect(
    screen.queryByText("Enter an amount, such as 84.20 or 600+150."),
  ).toBeNull();
});

test("the screen's own error shows in place of the amount's message", async () => {
  const user = userEvent.setup();
  render(<Amount error="Only $40.00 is ready to assign." />);

  await user.type(amount(), "12+");
  await user.tab();

  expect(
    screen.getByRole("textbox", {
      name: "Amount",
      description: "Only $40.00 is ready to assign.",
    }),
  ).toBeTruthy();
  expect(
    screen.queryByText("Enter an amount, such as 84.20 or 600+150."),
  ).toBeNull();
});

test("focusing the field selects the amount, so typing replaces it", async () => {
  const user = userEvent.setup();
  render(<Amount initial="1,250.00" />);

  await user.click(screen.getByText("Amount"));
  expect(amount().selectionStart).toBe(0);
  expect(amount().selectionEnd).toBe(8);

  await user.keyboard("40");
  expect(amount().value).toBe("40");
});

test("the amount is sent under its name with the form", async () => {
  const user = userEvent.setup();
  let sent: FormData | undefined;
  function Balance() {
    const [value, setValue] = useState("");
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sent = new FormData(event.currentTarget);
        }}
      >
        <Field label="Balance today">
          <AmountInput name="balance" value={value} onChange={setValue} />
        </Field>
      </form>
    );
  }
  render(<Balance />);

  await user.type(
    screen.getByRole("textbox", { name: "Balance today" }),
    "1250{Enter}",
  );

  expect(sent?.get("balance")).toBe("1,250");
});

test("a screen can reach the input to focus it", () => {
  const ref = createRef<HTMLInputElement>();
  render(
    <Field label="Amount">
      <AmountInput value="" onChange={() => undefined} inputRef={ref} />
    </Field>,
  );

  ref.current?.focus();

  expect(document.activeElement).toBe(amount());
});

// A phone or tablet: the page's pointer is a finger.
function onCoarsePointer() {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(pointer: coarse)",
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

test("on a phone the operator keys show while the amount has focus", async () => {
  onCoarsePointer();
  const user = userEvent.setup();
  render(<Amount />);
  expect(screen.queryByRole("button", { name: "Divide by" })).toBeNull();

  await user.click(amount());
  expect(screen.getByRole("button", { name: "Divide by" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("button", { name: "Divide by" })).toBeNull();
});

test("tapping an operator key keeps the keyboard on the amount", async () => {
  onCoarsePointer();
  const user = userEvent.setup();
  render(<Amount />);
  await user.click(amount());

  await user.click(screen.getByRole("button", { name: "Plus" }));
  await user.click(screen.getByRole("button", { name: "Times" }));

  expect(document.activeElement).toBe(amount());
  expect(screen.getByRole("button", { name: "Divide by" })).toBeTruthy();
});

test("an operator key goes in at the caret, and leaving gives the result", async () => {
  onCoarsePointer();
  const user = userEvent.setup();
  render(<Amount />);
  await user.type(amount(), "84.20");

  await user.click(screen.getByRole("button", { name: "Divide by" }));
  await user.keyboard("3");
  expect(amount().value).toBe("84.20÷3");

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(amount().value).toBe("28.07");
});

test("with a mouse there are no operator keys; you type them", async () => {
  const user = userEvent.setup();
  render(<Amount />);

  await user.click(amount());

  expect(screen.queryByRole("button", { name: "Divide by" })).toBeNull();
});
