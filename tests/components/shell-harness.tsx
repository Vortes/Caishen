import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import superjson from "superjson";
import { afterEach, vi } from "vitest";
import type { State } from "~/components/budget/types";
import { LiveAppShell } from "~/components/prototype/app-shell/live-app-shell";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "~/domain/engine";
import { api, type RouterInputs } from "~/trpc/react";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// A fixed response fixture, never a server emulator. Tests choose the next
// response explicitly; submitted commands are not applied to this book.
export function stateFixture({
  month = "2026-10",
  assigned = 10_000,
  revision = 5,
  seedCommands = [],
}: {
  month?: string;
  assigned?: number;
  revision?: number;
  seedCommands?: Command[];
} = {}): State {
  let book = createBook("owner", "Component budget", "2026-10");
  const commands: Command[] = [
    {
      type: "account.add",
      id: "account",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      date: "2026-10-01",
      openingBalance: 100_000,
    },
    {
      type: "category.add",
      id: "category",
      categoryId: "gifts",
      name: "Gifts",
    },
    {
      type: "assign",
      id: "assign",
      categoryId: "gifts",
      month: "2026-10",
      amount: assigned,
    },
    ...seedCommands,
  ];
  for (const command of commands) book = execute(book, "owner", command);
  return {
    view: projectBook(book, "owner", month, "2026-10"),
    revision,
    history: { undo: "Assign money", redo: null },
    services: [],
    connections: [],
    evidence: [],
    imports: [],
  };
}

type ExecuteInput = RouterInputs["budget"]["execute"];
const clients = new Set<QueryClient>();
afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

export async function renderShell(
  options: {
    read?: (month: string) => State | Promise<State>;
    execute?: (
      input: ExecuteInput,
    ) => { revision: number } | Promise<{ revision: number }>;
  } = {},
) {
  const read = vi.fn(options.read ?? (() => stateFixture()));
  const execute = vi.fn(options.execute ?? (() => ({ revision: 6 })));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.add(queryClient);
  const client = api.createClient({
    links: [
      httpLink({
        url: "http://component.invalid/api/trpc",
        transformer: superjson,
        fetch: async (address, options) => {
          const url = new URL(
            typeof address === "string"
              ? address
              : address instanceof URL
                ? address.href
                : address.url,
          );
          const input = superjson.parse<ExecuteInput & { month: string }>(
            typeof options?.body === "string"
              ? options.body
              : url.searchParams.get("input")!,
          );
          try {
            const result = url.pathname.endsWith("/budget.state")
              ? await read(input.month)
              : url.pathname.endsWith("/budget.execute")
                ? await execute(input)
                : (() => {
                    throw new Error(
                      `Unexpected component request: ${url.pathname}`,
                    );
                  })();
            return Response.json({
              result: { data: superjson.serialize(result) },
            });
          } catch (error) {
            return Response.json(
              {
                error: superjson.serialize({
                  message:
                    error instanceof Error ? error.message : "Request failed",
                  code: -32603,
                  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
                }),
              },
              { status: 500 },
            );
          }
        },
      }),
    ],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        <LiveAppShell />
      </api.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Plan" });
  return { user: userEvent.setup(), read, execute, queryClient };
}

export async function openPurchase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Add transaction" }));
  await user.keyboard("{Escape}");
  const form = screen.getByRole("form", { name: "New transaction" });
  await user.type(
    within(form).getByLabelText("Payee", { exact: true }),
    "Market",
  );
  await user.click(within(form).getByRole("combobox", { name: "Category" }));
  await user.type(
    within(form).getByRole("combobox", { name: "Category" }),
    "Gifts",
  );
  await user.keyboard("{Enter}");
  await user.type(
    within(form).getByLabelText("Outflow", { exact: true }),
    "12.50",
  );
  return form;
}
