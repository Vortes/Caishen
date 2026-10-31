import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { DateField } from "~/components/ui/date-field";
import { Field } from "~/components/ui/field";
import { SurfaceProvider } from "~/components/ui/surface";

function BalanceAsOf({
  initial = "",
  error,
}: {
  initial?: string;
  error?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SurfaceProvider container={document.body}>
      <Field label="Balance as of" error={error}>
        <DateField
          value={value}
          onChange={setValue}
          min="2026-01-01"
          max="2026-10-30"
          today="2026-10-30"
        />
      </Field>
      <output role="status">{value}</output>
    </SurfaceProvider>
  );
}

test("the field's label names the date and its error describes it", () => {
  render(
    <BalanceAsOf error="Choose a date between your budget start and today." />,
  );

  const date = screen.getByRole("combobox", {
    name: "Balance as of",
    description: "Choose a date between your budget start and today.",
  });
  expect(date.getAttribute("aria-invalid")).toBe("true");
});

test("a month and day are filled out with this year when you leave the field", async () => {
  const user = userEvent.setup();
  render(<BalanceAsOf />);

  const date = screen.getByRole("combobox", { name: "Balance as of" });
  await user.type(date, "10/3");
  await user.tab();

  expect((date as HTMLInputElement).value).toBe("10/03/2026");
  expect(screen.getByRole("status").textContent).toBe("2026-10-03");
});

test("a two-digit year is filled out to the full year", async () => {
  const user = userEvent.setup();
  render(<BalanceAsOf />);

  const date = screen.getByRole("combobox", { name: "Balance as of" });
  await user.type(date, "3/7/26");
  await user.tab();

  expect((date as HTMLInputElement).value).toBe("03/07/2026");
  expect(screen.getByRole("status").textContent).toBe("2026-03-07");
});

test("a day picked from the calendar becomes the date", async () => {
  const user = userEvent.setup();
  render(<BalanceAsOf initial="2026-10-03" />);

  await user.click(screen.getByRole("combobox", { name: "Balance as of" }));
  await user.click(
    screen.getByRole("button", { name: "Friday, October 16, 2026" }),
  );

  expect(screen.getByRole("status").textContent).toBe("2026-10-16");
  expect(
    screen.getByRole<HTMLInputElement>("combobox", { name: "Balance as of" })
      .value,
  ).toBe("10/16/2026");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("text it can't read stays as typed, and the field says how to fix it", async () => {
  const user = userEvent.setup();
  render(<BalanceAsOf />);

  const date = screen.getByRole("combobox", { name: "Balance as of" });
  await user.type(date, "13/45");
  await user.tab();

  expect((date as HTMLInputElement).value).toBe("13/45");
  expect(
    screen.getByRole("combobox", {
      name: "Balance as of",
      description: "Enter a date, such as 10/30/2026.",
    }),
  ).toBe(date);
  expect(date.getAttribute("aria-invalid")).toBe("true");

  await user.clear(date);
  await user.type(date, "10/13/2026");

  expect(date.getAttribute("aria-invalid")).toBeNull();
  expect(screen.queryByText("Enter a date, such as 10/30/2026.")).toBeNull();
});

test("days after the latest day can't be picked", async () => {
  const user = userEvent.setup();
  render(<BalanceAsOf initial="2026-10-03" />);

  await user.click(screen.getByRole("combobox", { name: "Balance as of" }));
  const tomorrow = screen.getByRole("button", {
    name: "Saturday, October 31, 2026",
  });
  await user.click(tomorrow);

  expect((tomorrow as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("2026-10-03");
});
