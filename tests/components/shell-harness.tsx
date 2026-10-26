import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { LiveAppShell } from "~/components/app-shell/live-app-shell";
import type {
  ExecuteInput,
  PullInput,
  PullResult,
} from "~/components/sync/transport";
import { createBook, execute, type Book, type Command } from "~/domain/engine";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { appLinks } from "~/trpc/links";
import { componentFetch } from "./component-server";
import { FakeServer } from "./sync/fake-server";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** The owner's budget: a checking account and Gifts with money assigned. */
export function budgetFixture({
  assigned = 10_000,
  seedCommands = [],
}: { assigned?: number; seedCommands?: Command[] } = {}): Book {
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
  return book;
}

export type Overview = RouterOutputs["budget"]["overview"];
type ImportInput = RouterInputs["budget"]["resolveImport"];
type SetupInput = RouterInputs["budget"]["setupBankAccounts"];
type Answer<T> = T | Promise<T>;
type Executed = ReturnType<FakeServer["execute"]>;

type ReadyOverview = Extract<Overview, { status: "ready" }>;
export const readyOverview = (
  overview: Partial<ReadyOverview> = {},
): ReadyOverview => ({
  status: "ready",
  services: [],
  connections: [],
  imports: [],
  partnerFirstName: null,
  ...overview,
});

const clients = new Set<QueryClient>();
afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

/**
 * Renders the live shell against a fake server running the real engine.
 * The browser reaches it through the app's own tRPC links, so commands,
 * pulls, refusals, and revision headers go the way they do in the app.
 */
export async function renderShell(
  options: {
    book?: Book;
    server?: FakeServer;
    seedCommands?: Command[];
    // Answers budget.execute; the fake server's answer unless a test holds
    // or fails it.
    execute?: (input: ExecuteInput, server: FakeServer) => Answer<Executed>;
    // Answers sync.pull; the fake server's answer unless a test fails it.
    pull?: (input: PullInput, server: FakeServer) => Answer<PullResult>;
    overview?: (server: FakeServer) => Answer<Overview>;
    resolveImport?: (
      input: ImportInput,
      server: FakeServer,
    ) => Answer<Executed & { resolved: true }>;
    setupBankAccounts?: (
      input: SetupInput,
      server: FakeServer,
    ) => Answer<Executed & { accountIds: string[] }>;
    sync?: (server: FakeServer) => Answer<RouterOutputs["budget"]["sync"]>;
    bankLink?: {
      token: (
        input: RouterInputs["budget"]["plaidLinkToken"],
      ) => Answer<RouterOutputs["budget"]["plaidLinkToken"]>;
      review: (
        input: RouterInputs["budget"]["plaidLinkReview"],
      ) => Answer<RouterOutputs["budget"]["plaidLinkReview"]>;
      exchange: (
        input: RouterInputs["budget"]["plaidExchange"],
      ) => Answer<RouterOutputs["budget"]["plaidExchange"]>;
      reconnect?: (
        input: RouterInputs["budget"]["plaidReconnect"],
      ) => Answer<RouterOutputs["budget"]["plaidReconnect"]>;
    };
    // Wait for the budget navigation; off for screens shown in its place.
    plan?: boolean;
  } = {},
) {
  const server =
    options.server ??
    new FakeServer(
      options.book ?? budgetFixture({ seedCommands: options.seedCommands }),
    );
  const execute = vi.fn(
    options.execute ??
      ((input: ExecuteInput) => server.execute("owner", input)),
  );
  const overview = vi.fn(options.overview ?? (() => readyOverview()));
  const initialOverview = await overview(server);
  if (initialOverview.status === "ready")
    server.seedImports("owner", initialOverview.imports);
  // An import saves the command it carries, as the server does.
  const resolveImport = vi.fn(async (input: ImportInput) => {
    const result = options.resolveImport
      ? await options.resolveImport(input, server)
      : input.ignore
        ? { ...server.rejectImport("owner", input), resolved: true as const }
        : {
            ...server.execute("owner", {
              command: input.command!,
              baseRevision: input.expectedRevision,
              clientId: "import",
            }),
            resolved: true as const,
          };
    return input.ignore && !result.changeSet
      ? { ...server.rejectImport("owner", input), resolved: true as const }
      : {
          ...server.resolveImportRow("owner", input, result),
          resolved: true as const,
        };
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.add(queryClient);
  const client = api.createClient({
    links: appLinks({
      url: "http://component.invalid/api/trpc",
      fetch: componentFetch(server, "owner", {
        "budget.execute": (input) => execute(input as ExecuteInput, server),
        "budget.overview": () => overview(server),
        "sync.pull": (input) =>
          options.pull
            ? options.pull(input as PullInput, server)
            : server.pull("owner", input as PullInput),
        "budget.resolveImport": (input) => resolveImport(input as ImportInput),
        "budget.sync": () =>
          options.sync
            ? options.sync(server)
            : {
                imported: 0,
                updated: 0,
                revision: server.revision,
                changeSet: null,
                rebased: false,
              },
        "budget.plaidLinkToken": (input) => {
          if (!options.bankLink) throw new Error("Unexpected bank Link");
          return options.bankLink.token(
            input as RouterInputs["budget"]["plaidLinkToken"],
          );
        },
        "budget.plaidLinkReview": (input) => {
          if (!options.bankLink) throw new Error("Unexpected bank review");
          return options.bankLink.review(
            input as RouterInputs["budget"]["plaidLinkReview"],
          );
        },
        "budget.plaidExchange": (input) => {
          if (!options.bankLink) throw new Error("Unexpected bank exchange");
          return options.bankLink.exchange(
            input as RouterInputs["budget"]["plaidExchange"],
          );
        },
        "budget.plaidReconnect": (input) => {
          if (!options.bankLink?.reconnect)
            throw new Error("Unexpected bank reconnect");
          return options.bankLink.reconnect(
            input as RouterInputs["budget"]["plaidReconnect"],
          );
        },
        "budget.setupBankAccounts": (input) => {
          if (!options.setupBankAccounts)
            throw new Error("Unexpected bank setup");
          return options.setupBankAccounts(input as SetupInput, server);
        },
      }),
    }),
  });
  let generation = 0;
  const shell = () => (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        <LiveAppShell key={generation} />
      </api.Provider>
    </QueryClientProvider>
  );
  const rendered = render(shell());
  if (options.plan !== false)
    await screen.findByRole("navigation", { name: "Budget navigation" });
  return {
    user: userEvent.setup(),
    server,
    execute,
    overview,
    resolveImport,
    queryClient,
    reload: async (): Promise<void> => {
      generation++;
      queryClient.clear();
      rendered.rerender(shell());
      if (options.plan !== false)
        await screen.findByRole("navigation", { name: "Budget navigation" });
    },
  };
}

/** The commands the server was sent, in order. */
export function sent(execute: {
  mock: { calls: [ExecuteInput, ...unknown[]][] };
}) {
  return execute.mock.calls.map(([input]) => input.command);
}

const displaysPayee =
  (payee: string) => (_name: string, element: Element | null) =>
    element instanceof HTMLElement &&
    within(element).queryByText(payee, { exact: true }) !== null;

export function transactionRow(payee: string) {
  return within(screen.getByRole("group", { name: "Transactions" })).getByRole(
    "button",
    { name: displaysPayee(payee) },
  );
}

export function findTransactionRow(payee: string) {
  return within(screen.getByRole("group", { name: "Transactions" })).findByRole(
    "button",
    { name: displaysPayee(payee) },
  );
}

/** The toast showing `text`, once it appears. */
export async function findToast(
  text: string | RegExp,
  options?: { timeout?: number },
): Promise<HTMLElement> {
  const region = screen.getByRole("region", { name: "Notifications" });
  const message = await within(region).findByText(text, {}, options);
  return message.parentElement!;
}

/** Wait until leaving the shell no longer warns about unsaved changes. */
export async function waitForSaves() {
  await waitFor(() => {
    const leaving = new Event("beforeunload", { cancelable: true });
    if (!window.dispatchEvent(leaving))
      throw new Error("The shell still warns about unsaved changes.");
  });
}

/** The window regains focus, which makes the shell catch up. */
export async function refocus() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    await Promise.resolve();
  });
}

export async function openPurchase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("link", { name: /^Checking/ }));
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
