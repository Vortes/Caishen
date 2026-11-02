import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { Register } from "~/components/ui/register";

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

function Example({
  blocked = false,
  editor = false,
  grouped = false,
  empty = false,
  noMatch = false,
}: {
  blocked?: boolean;
  editor?: boolean;
  grouped?: boolean;
  empty?: boolean;
  noMatch?: boolean;
}) {
  const [selectedId, onSelect] = useState<string | null>(null);
  const [opened, setOpened] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <>
      <Register
        columns={[{ key: "name", label: "Name" }]}
        rows={empty ? [] : rows}
        empty={<p>Nothing recorded yet.</p>}
        noMatch={noMatch ? <p>No matching rows.</p> : undefined}
        cells={(row) => ({
          label: row.name,
          content: <span data-column="name">{row.name}</span>,
        })}
        selectedId={selectedId}
        onSelect={(id) => onSelect((current) => (current === id ? null : id))}
        onOpen={(row, column) => {
          setOpened(`${row.name}: ${column ?? "default"}`);
          if (editor) setEditingId(row.id);
        }}
        editingId={editingId}
        renderEditor={(row) =>
          row && (
            <form aria-label={`Edit ${row.name}`}>
              <input aria-label="Name" defaultValue={row.name} autoFocus />
              <button type="button" onClick={() => setEditingId(null)}>
                Close editor
              </button>
            </form>
          )
        }
        sections={
          grouped
            ? [
                {
                  key: "waiting",
                  label: "Pending",
                  "aria-label": "Pending rows",
                  rows: [rows[1]!],
                  open,
                  onOpenChange: setOpen,
                },
              ]
            : []
        }
        checked={checked}
        onCheck={(ids, value) =>
          setChecked((current) =>
            value
              ? [...new Set([...current, ...ids])]
              : current.filter((id) => !ids.includes(id)),
          )
        }
        checkable={(row) => !blocked || row.id !== "b"}
      />
      <output aria-label="Opened">{opened}</output>
    </>
  );
}

test("click selects the row", async () => {
  render(<Example />);
  await userEvent.click(screen.getByRole("button", { name: "Beta" }));
  expect(
    screen.getByRole("button", { name: "Beta", current: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Alpha" }).getAttribute("aria-current"),
  ).toBeNull();
});

test("a second pointer click opens the selected row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const row = screen.getByRole("button", { name: "Beta" });
  await user.click(row);
  expect(screen.getByLabelText("Opened").textContent).toBe("");
  await user.click(row);
  expect(screen.getByLabelText("Opened").textContent).toBe("Beta: name");
});

test("double-click opens the clicked field without selecting a word", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const field = within(screen.getByRole("button", { name: "Gamma" })).getByText(
    "Gamma",
  );
  await user.dblClick(field);
  expect(screen.getByLabelText("Opened").textContent).toBe("Gamma: name");
  expect(window.getSelection()?.toString()).toBe("");
});

test("Enter only selects, including on an already selected row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.tab();
  await user.tab();
  await user.tab();
  await user.keyboard("{Enter}{Enter}");
  expect(
    screen.getByRole("button", { name: "Alpha", current: true }),
  ).toBeTruthy();
  expect(screen.getByLabelText("Opened").textContent).toBe("");
});

test("arrow keys move focus and selection without opening a row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  expect(screen.getByRole("button", { name: "Gamma", current: true })).toBe(
    document.activeElement,
  );
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("button", { name: "Beta", current: true })).toBe(
    document.activeElement,
  );
  expect(screen.getByLabelText("Opened").textContent).toBe("");
});

test("x checks and unchecks the focused row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Beta" }));
  await user.keyboard("x");
  expect(
    screen.getByRole("checkbox", { name: "Select Beta", checked: true }),
  ).toBeTruthy();
  await user.keyboard("x");
  expect(
    screen.getByRole("checkbox", { name: "Select Beta", checked: false }),
  ).toBeTruthy();
});

test("e opens the selected row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Gamma" }));
  await user.keyboard("e");
  expect(screen.getByLabelText("Opened").textContent).toBe("Gamma: default");
});

test("Shift-click checks the range from the last clicked row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  await user.keyboard("{Shift>}");
  await user.click(screen.getByRole("button", { name: "Gamma" }));
  await user.keyboard("{/Shift}");
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    expect(
      screen.getByRole("checkbox", { name: `Select ${name}`, checked: true }),
    ).toBeTruthy();
  }
  await user.keyboard("{Shift>}");
  await user.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
  await user.keyboard("{/Shift}");
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
});

test("Select all checks every row and clears a partial selection", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("checkbox", { name: "Select Beta" }));
  const all = screen.getByRole("checkbox", { name: "Select all" });
  expect(all.getAttribute("aria-checked")).toBe("mixed");
  await user.click(all);
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  await user.click(all);
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(4);
});

test("uncheckable rows remain selectable but cannot be checked by x, a range, or Select all", async () => {
  const user = userEvent.setup();
  render(<Example blocked />);
  expect(screen.queryByRole("checkbox", { name: "Select Beta" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Beta" }));
  await user.keyboard("x");
  expect(
    screen.getByRole("button", { name: "Beta", current: true }),
  ).toBeTruthy();
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  await user.keyboard("{Shift>}");
  await user.click(screen.getByRole("button", { name: "Gamma" }));
  await user.keyboard("{/Shift}");
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);
  await user.click(screen.getByRole("checkbox", { name: "Select all" }));
  await user.click(screen.getByRole("checkbox", { name: "Select all" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);
});

test("focus returns to the row after its editor closes", async () => {
  const user = userEvent.setup();
  render(<Example editor />);
  await user.dblClick(screen.getByRole("button", { name: "Beta" }));
  expect(screen.getByRole("textbox", { name: "Name" })).toBe(
    document.activeElement,
  );
  await user.click(screen.getByRole("button", { name: "Close editor" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Beta" })).toBe(
      document.activeElement,
    ),
  );
});

test("sections use the same selection rules and keep an editor visible when collapsed", async () => {
  const user = userEvent.setup();
  render(<Example grouped editor />);
  const group = within(screen.getByRole("group", { name: "Pending rows" }));
  await user.click(group.getByRole("button", { name: "Beta" }));
  await user.keyboard("x");
  expect(
    group.getByRole("checkbox", { name: "Select Beta", checked: true }),
  ).toBeTruthy();
  await user.keyboard("e");
  await user.click(group.getByRole("button", { name: /Pending/ }));
  expect(group.getByRole("form", { name: "Edit Beta" })).toBeTruthy();
  await user.click(group.getByRole("button", { name: "Close editor" }));
  expect(group.queryByRole("button", { name: "Beta" })).toBeNull();
  await user.click(group.getByRole("button", { name: /Pending/ }));
  await user.dblClick(group.getByRole("button", { name: "Beta" }));
  expect(group.getByRole("form", { name: "Edit Beta" })).toBeTruthy();
});

test("empty renders the caller's message without a header", () => {
  render(<Example empty />);
  expect(screen.getByText("Nothing recorded yet.")).toBeTruthy();
  expect(screen.queryByText("Name")).toBeNull();
});

test("noMatch renders the caller's filtered message", () => {
  render(<Example empty noMatch />);
  expect(screen.getByText("No matching rows.")).toBeTruthy();
  expect(screen.queryByText("Nothing recorded yet.")).toBeNull();
});

test("collapsed section rows are excluded from ranges and Select all", async () => {
  const user = userEvent.setup();
  render(<Example grouped />);
  await user.click(screen.getByRole("button", { name: /Pending/ }));
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  await user.keyboard("{Shift>}");
  await user.click(screen.getByRole("button", { name: "Gamma" }));
  await user.keyboard("{/Shift}");
  await user.click(screen.getByRole("button", { name: /Pending/ }));
  expect(
    screen.getByRole("checkbox", { name: "Select Beta", checked: false }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Pending/ }));
  await user.click(screen.getByRole("checkbox", { name: "Select all" }));
  await user.click(screen.getByRole("checkbox", { name: "Select all" }));
  await user.click(screen.getByRole("button", { name: /Pending/ }));
  expect(
    screen.getByRole("checkbox", { name: "Select Beta", checked: false }),
  ).toBeTruthy();
});

test("editor fields keep their arrow keys and letter input", async () => {
  const user = userEvent.setup();
  render(<Example editor />);
  await user.dblClick(screen.getByRole("button", { name: "Beta" }));
  const input = screen.getByRole("textbox", { name: "Name" });
  await user.keyboard("{ArrowDown}xe");
  expect(input).toBe(document.activeElement);
  expect(input).toHaveProperty("value", "Betaxe");
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
});

test("finishing a text selection does not select or open the row", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const row = screen.getByRole("button", { name: "Alpha" });
  const field = within(row).getByText("Alpha");
  await user.pointer([
    { target: field, offset: 0, keys: "[MouseLeft>]" },
    { target: field, offset: 3 },
    { keys: "[/MouseLeft]" },
  ]);
  expect(window.getSelection()?.toString()).toBe("Alp");
  expect(row.getAttribute("aria-current")).toBeNull();
  expect(screen.getByLabelText("Opened").textContent).toBe("");
});

test("layout preserves a caller's row gutter", () => {
  render(
    <Register
      columns={[{ key: "name", label: "Name" }]}
      rows={rows}
      cells={(row) => ({ label: row.name, content: row.name })}
      checkable={() => false}
      selectedId={null}
      onSelect={() => {}}
      checked={[]}
      onCheck={() => {}}
      onOpen={() => {}}
      layout={{ wide: "minmax(0, 1fr)", gutter: "34px" }}
    />,
  );

  expect(
    getComputedStyle(
      screen.getByRole("group", { name: "Register" }),
    ).getPropertyValue("--row-gutter"),
  ).toBe("34px");
});
