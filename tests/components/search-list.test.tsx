import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { expect, test } from "vitest";
import { Field } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import {
  DetailOption,
  SearchList,
  SearchListDetail,
  SearchSuggestions,
} from "~/components/ui/search-list";
import { SurfaceProvider } from "~/components/ui/surface";

const categories = [
  { value: "rta", label: "Ready to Assign", group: "Inflow", amount: 50000 },
  { value: "rent", label: "Rent", group: "Bills", amount: 120000 },
  { value: "power", label: "Electric", group: "Bills", amount: 0 },
  { value: "food", label: "Groceries", group: "Everyday", amount: -2500 },
];

function Category({
  error,
  initial = "",
  ...props
}: Partial<ComponentProps<typeof SearchList>> & {
  error?: string;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SurfaceProvider container={document.body}>
      <Field label="Category" error={error}>
        <SearchList
          value={value}
          onChange={setValue}
          options={categories}
          placeholder="Choose a category"
          {...props}
        />
      </Field>
      <output aria-label="Chosen">{value}</output>
    </SurfaceProvider>
  );
}

test("the field's label names the list and its error describes it", async () => {
  const user = userEvent.setup();
  render(<Category error="Choose where to move it." />);

  const field = screen.getByRole("combobox", { name: "Category" });
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(field.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Choose where to move it.");

  await user.click(field);
  expect(screen.getByRole("listbox", { name: "Category" })).toBeDefined();
});

test("arriving opens the list with the chosen name selected, so typing replaces it", async () => {
  const user = userEvent.setup();
  render(<Category initial="rent" />);

  await user.tab();

  const field = screen.getByRole("combobox", { name: "Category" });
  expect(field.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("listbox", { name: "Category" })).toBeDefined();
  const input = field as HTMLInputElement;
  expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe(
    "Rent",
  );
  expect(screen.getByRole("option", { selected: true }).textContent).toContain(
    "Rent",
  );
});

test("focus a click lands elsewhere, on the label or a button that opens the form, leaves the list closed", async () => {
  const user = userEvent.setup();
  render(<Category initial="rent" />);
  const field = screen.getByRole("combobox", { name: "Category" });

  await user.click(screen.getByText("Category", { selector: "label" }));
  expect(field.getAttribute("aria-expanded")).toBe("false");

  await user.click(document.body);
  field.focus();
  expect(field.getAttribute("aria-expanded")).toBe("false");

  await user.click(field);
  expect(field.getAttribute("aria-expanded")).toBe("true");
});

test("typing filters the options by their label and their group", async () => {
  const user = userEvent.setup();
  render(<Category />);

  await user.click(screen.getByRole("combobox", { name: "Category" }));
  await user.keyboard("ren");
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Rent$1,200.00"]);

  await user.clear(screen.getByRole("combobox", { name: "Category" }));
  await user.keyboard("bills");
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Rent$1,200.00", "Electric$0.00"]);
});

test("the arrow keys move from the chosen option, and Enter picks and closes the list", async () => {
  const user = userEvent.setup();
  render(<Category initial="rent" />);

  const field = screen.getByRole("combobox", { name: "Category" });
  await user.click(field);
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}");

  expect(screen.getByRole("status", { name: "Chosen" }).textContent).toBe(
    "food",
  );
  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect((field as HTMLInputElement).value).toBe("Groceries");
});

test("Tab takes the highlighted match once something is typed, and takes nothing before", async () => {
  const user = userEvent.setup();
  render(
    <>
      <Category />
      <button type="button">Next</button>
    </>,
  );
  const chosen = screen.getByRole("status", { name: "Chosen" });

  await user.tab();
  await user.tab();
  expect(chosen.textContent).toBe("");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Next" }),
  );

  await user.tab({ shift: true });
  await user.keyboard("ren");
  await user.tab();
  expect(chosen.textContent).toBe("rent");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Next" }),
  );
});

test("Escape closes only the list, and the popover around it stays open", async () => {
  const user = userEvent.setup();
  render(
    <SurfaceProvider container={document.body}>
      <Popover label="Move money" trigger={<button>Move</button>}>
        <Field label="To">
          <SearchList
            value=""
            onChange={() => undefined}
            options={categories}
          />
        </Field>
      </Popover>
    </SurfaceProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Move" }));
  const field = screen.getByRole("combobox", { name: "To" });
  await user.click(field);
  await user.keyboard("{Escape}");

  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("dialog", { name: "Move money" })).toBeDefined();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Move money" })).toBeNull();
});

test("the New row carries the typed name, and Enter takes it once nothing else matches", async () => {
  const user = userEvent.setup();
  const created: string[] = [];
  render(
    <Category
      onCreate={{ noun: "category", create: (name) => created.push(name) }}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Category" }));
  expect(screen.getByRole("option", { name: "New category" })).toBeDefined();

  await user.keyboard("Gifts");
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["New category “Gifts”"]);
  await user.keyboard("{Enter}");

  expect(created).toEqual(["Gifts"]);
  expect(screen.getByRole("status", { name: "Chosen" }).textContent).toBe("");
});

test("maxLength stops a new name where it would be refused", async () => {
  const user = userEvent.setup();
  const created: string[] = [];
  render(
    <Category
      maxLength={12}
      onCreate={{ noun: "category", create: (name) => created.push(name) }}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Category" }));
  await user.keyboard("Weekend getaways{Enter}");

  expect(created).toEqual(["Weekend geta"]);
});

test("the action row runs its action and picks nothing", async () => {
  const user = userEvent.setup();
  const actions: string[] = [];
  render(
    <Category
      initial="rent"
      onCreate={{ noun: "category", create: () => undefined }}
      action={{
        label: "Split",
        icon: null,
        onSelect: () => actions.push("split"),
      }}
    />,
  );

  const field = screen.getByRole("combobox", { name: "Category" });
  await user.click(field);
  await user.click(screen.getByRole("option", { name: "Split" }));

  expect(actions).toEqual(["split"]);
  expect(screen.getByRole("status", { name: "Chosen" }).textContent).toBe(
    "rent",
  );
  expect(field.getAttribute("aria-expanded")).toBe("false");
});

test("an option that can't be picked still shows, and neither a click nor the arrows take it", async () => {
  const user = userEvent.setup();
  render(
    <Category
      options={categories.map((option) =>
        option.value === "power" ? { ...option, disabled: true } : option,
      )}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Category" }));
  const electric = screen.getByRole("option", { name: /Electric/ });
  expect(electric.getAttribute("aria-disabled")).toBe("true");
  await user.click(electric);
  expect(screen.getByRole("status", { name: "Chosen" }).textContent).toBe("");

  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(screen.getByRole("status", { name: "Chosen" }).textContent).toBe(
    "food",
  );
});

test("each group's name heads its options, once", async () => {
  const user = userEvent.setup();
  render(<Category />);

  await user.click(screen.getByRole("combobox", { name: "Category" }));

  const list = screen.getByRole("listbox", { name: "Category" });
  expect(
    within(list)
      .getAllByText(/^(Inflow|Bills|Everyday)$/)
      .map((heading) => heading.textContent),
  ).toEqual(["Inflow", "Bills", "Everyday"]);
});

test("a click picks and moves on, and the closed field shows the label alone", async () => {
  const user = userEvent.setup();
  const picked: string[] = [];
  render(<Category onPicked={(value) => picked.push(value)} />);

  const field = screen.getByRole("combobox", { name: "Category" });
  await user.click(field);
  await user.click(screen.getByRole("option", { name: /Rent/ }));

  expect(picked).toEqual(["rent"]);
  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect((field as HTMLInputElement).value).toBe("Rent");
  expect(field.parentElement!.textContent).not.toContain("$");
});

// Suggestions mode: free text, with earlier names offered under it.

function Payee({ onSubmit }: { onSubmit?: (payee: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <SurfaceProvider container={document.body}>
      <form
        aria-label="Purchase"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(value);
        }}
      >
        <Field label="Payee">
          <SearchSuggestions
            value={value}
            onChange={setValue}
            suggestions={["Trader Joe’s", "Target", "Corner Deli"]}
          />
        </Field>
      </form>
      <output aria-label="Typed">{value}</output>
    </SurfaceProvider>
  );
}

test("any text typed reaches onChange, matching a suggestion or not", async () => {
  const user = userEvent.setup();
  render(<Payee />);

  await user.type(screen.getByRole("combobox", { name: "Payee" }), "Tar");
  expect(screen.getByRole("status", { name: "Typed" }).textContent).toBe("Tar");
  await user.keyboard("dis");
  expect(screen.getByRole("status", { name: "Typed" }).textContent).toBe(
    "Tardis",
  );
});

test("a suggestion is taken with the arrow keys and Enter, or with a click", async () => {
  const user = userEvent.setup();
  const submitted: string[] = [];
  render(<Payee onSubmit={(payee) => submitted.push(payee)} />);
  const field = screen.getByRole("combobox", { name: "Payee" });
  const typed = screen.getByRole("status", { name: "Typed" });

  await user.click(field);
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Trader Joe’s", "Target", "Corner Deli"]);
  await user.keyboard("ta{ArrowDown}{ArrowDown}{Enter}");
  expect(typed.textContent).toBe("Target");
  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect(submitted).toEqual([]);

  await user.clear(field);
  await user.keyboard("deli");
  await user.click(screen.getByRole("option", { name: "Corner Deli" }));
  expect(typed.textContent).toBe("Corner Deli");
  expect(field.getAttribute("aria-expanded")).toBe("false");
});

test("Enter on typed text sends the surrounding form, even with suggestions showing", async () => {
  const user = userEvent.setup();
  const submitted: string[] = [];
  render(<Payee onSubmit={(payee) => submitted.push(payee)} />);

  await user.type(screen.getByRole("combobox", { name: "Payee" }), "Tar");
  expect(screen.getByRole("option", { name: "Target" })).toBeDefined();
  await user.keyboard("{Enter}");

  expect(submitted).toEqual(["Tar"]);
});

const people = [
  { value: "mei", label: "Mei Chen", amount: 12050, tag: "On Caishen" },
  { value: "mom", label: "Mom", amount: -4000 },
  { value: "momd", label: "Momd", amount: 0 },
  { value: "sam", label: "Sam", amount: 0 },
];

// A share picker in miniature: who on the left, how much on the right.
function Picker(
  props: Partial<ComponentProps<typeof SearchListDetail>> & {
    picked?: string[];
  },
) {
  const { picked = [], ...rest } = props;
  return (
    <SurfaceProvider container={document.body}>
      <Popover
        label="Who this is for"
        trigger={<button>Share</button>}
        size="wide"
      >
        <SearchListDetail
          label="Who is this for"
          options={people}
          value="mom"
          defaultHighlight="mom"
          createNoun="person"
          placeholder="Find or add a person"
          maxLength={120}
          detail={(highlight) => {
            const name =
              highlight?.kind === "option"
                ? highlight.option.label
                : highlight?.name;
            return {
              label: name ? `How much is for ${name}` : "How much",
              title: name ?? "Choose who it’s for",
              children: (
                <>
                  <DetailOption
                    title="Half"
                    detail="$15.00"
                    disabled={!name}
                    onClick={() => picked.push(`half ${name}`)}
                  />
                  <DetailOption
                    title="All of it"
                    detail="$30.00"
                    disabled={!name}
                    pressed={name === "Mom"}
                    onClick={() => picked.push(`all ${name}`)}
                  />
                </>
              ),
            };
          }}
          {...rest}
        />
      </Popover>
    </SurfaceProvider>
  );
}

async function openPicker(props: Parameters<typeof Picker>[0] = {}) {
  const user = userEvent.setup();
  render(<Picker {...props} />);
  await user.click(screen.getByRole("button", { name: "Share" }));
  const search = screen.getByRole("combobox", { name: "Who is this for" });
  return { user, search };
}

const highlighted = (search: HTMLElement) =>
  document.getElementById(search.getAttribute("aria-activedescendant") ?? "")
    ?.textContent;
const optionNames = () =>
  screen.getAllByRole("option").map((option) => option.textContent);

test("the search opens empty beside the always-open list, with the default highlight's detail", async () => {
  const { search } = await openPicker();

  expect(document.activeElement).toBe(search);
  expect(search).toHaveProperty("value", "");
  expect(search.getAttribute("aria-expanded")).toBe("true");
  expect(highlighted(search)).toMatch(/^Mom/);
  expect(
    screen.getByRole("listbox", { name: "Who is this for" }),
  ).toBeDefined();
  expect(
    screen.getByRole("option", { name: /^Mom-/ }).getAttribute("aria-selected"),
  ).toBe("true");
  // The one person on Caishen carries the mark; no group headings.
  expect(optionNames()[0]).toBe("Mei ChenOn Caishen$120.50");
  expect(screen.queryByText("People")).toBeNull();
  const detail = screen.getByRole("group", { name: "How much is for Mom" });
  expect(within(detail).getByText("Mom")).toBeDefined();
});

test("the arrow keys move the highlight, the detail follows, and the ends hold", async () => {
  const { user, search } = await openPicker();

  await user.keyboard("{ArrowDown}");
  expect(highlighted(search)).toMatch(/^Momd/);
  expect(
    screen.getByRole("group", { name: "How much is for Momd" }),
  ).toBeDefined();
  await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
  expect(highlighted(search)).toMatch(/^Mei Chen/);
});

test("typing filters, the highlight takes the first match, and New carries a name nothing matches", async () => {
  const { user, search } = await openPicker();

  await user.keyboard("mo");
  expect(optionNames()).toEqual(["New person “mo”", "Mom-$40.00", "Momd$0.00"]);
  expect(highlighted(search)).toMatch(/^Mom-/);

  await user.keyboard("x");
  expect(optionNames()).toEqual(["New person “mox”"]);
  expect(highlighted(search)).toBe("New person “mox”");
  expect(
    screen.getByRole("group", { name: "How much is for mox" }),
  ).toBeDefined();

  // A name already listed is never offered as new.
  await user.clear(search);
  await user.keyboard("mom");
  expect(optionNames()).toEqual(["Mom-$40.00", "Momd$0.00"]);
});

test("Enter crosses into the detail at its pressed choice; ArrowLeft or a letter comes back", async () => {
  const { user, search } = await openPicker();

  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /^All of it/ }),
  );
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /^Half/ }),
  );
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(search);

  await user.keyboard("{ArrowDown}{ArrowRight}");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /^Half/ }),
  );
  await user.keyboard("s");
  expect(document.activeElement).toBe(search);
  expect(search).toHaveProperty("value", "s");
});

test("ArrowRight crosses only with the caret at the end of the search", async () => {
  const { user, search } = await openPicker();

  await user.keyboard("mo{ArrowLeft}{ArrowRight}");
  expect(document.activeElement).toBe(search);
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /^All of it/ }),
  );
});

test("Escape clears the search first, then closes the popover", async () => {
  const { user, search } = await openPicker();

  await user.keyboard("sa{Escape}");
  expect(search).toHaveProperty("value", "");
  expect(screen.getByRole("dialog", { name: "Who this is for" })).toBeDefined();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Who this is for" })).toBeNull();
});

test("the pointer highlights the row it rests on, and a click crosses into the detail", async () => {
  const picked: string[] = [];
  const { user, search } = await openPicker({ picked });

  fireEvent.mouseMove(screen.getByRole("option", { name: /^Sam/ }), {
    clientX: 20,
    clientY: 120,
  });
  expect(highlighted(search)).toMatch(/^Sam/);

  await user.click(screen.getByRole("option", { name: /^Momd/ }));
  expect(highlighted(search)).toMatch(/^Momd/);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /^Half/ }),
  );
  await user.click(screen.getByRole("button", { name: /^All of it/ }));
  expect(picked).toEqual(["all Momd"]);
});

test("moving right toward the detail waits before following the pointer, and reaching it cancels", async () => {
  const { search } = await openPicker();
  const mom = screen.getByRole("option", { name: /^Mom-/ });
  const sam = screen.getByRole("option", { name: /^Sam/ });

  fireEvent.mouseMove(mom, { clientX: 20, clientY: 60 });
  fireEvent.mouseMove(sam, { clientX: 80, clientY: 90 });
  expect(highlighted(search)).toMatch(/^Mom-/);
  await waitFor(() => expect(highlighted(search)).toMatch(/^Sam/));

  fireEvent.mouseMove(mom, { clientX: 20, clientY: 60 });
  fireEvent.mouseMove(sam, { clientX: 80, clientY: 90 });
  fireEvent.mouseMove(
    screen.getByRole("group", { name: "How much is for Mom" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(highlighted(search)).toMatch(/^Mom-/);
});

test("with no default highlight the detail waits for a choice, and an empty list says why", async () => {
  const { search } = await openPicker({
    defaultHighlight: undefined,
    options: [],
    empty: "You haven’t shared with anyone yet",
  });

  expect(search.getAttribute("aria-activedescendant")).toBeNull();
  expect(screen.getByText("You haven’t shared with anyone yet")).toBeDefined();
  expect(screen.getByRole("group", { name: "How much" })).toBeDefined();
  expect(screen.getByRole("button", { name: /^Half/ })).toHaveProperty(
    "disabled",
    true,
  );
});

test("maxLength stops a typed name where it would be refused", async () => {
  const { user, search } = await openPicker({ maxLength: 5 });

  await user.keyboard("Alexandra");
  expect(search).toHaveProperty("value", "Alexa");
});

test("a pointer's pending highlight gives way to the arrow keys", async () => {
  const { user, search } = await openPicker();

  fireEvent.mouseMove(screen.getByRole("option", { name: /^Mom-/ }), {
    clientX: 20,
    clientY: 60,
  });
  fireEvent.mouseMove(screen.getByRole("option", { name: /^Sam/ }), {
    clientX: 80,
    clientY: 90,
  });
  await user.keyboard("{ArrowUp}");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(highlighted(search)).toMatch(/^Mei Chen/);
});
