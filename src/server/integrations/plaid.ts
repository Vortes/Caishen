import { z } from "zod";

import {
  readPlaidTransaction,
  type QuarantinedTransaction,
  type TransactionSyncDelta,
} from "./transactions";
import {
  IntegrationError,
  providerIdSchema,
  readJsonResponse,
} from "./validation";

export interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: "sandbox" | "production";
  redirectUri?: string;
}

export function validatePlaidRedirectUri(
  value: string | undefined,
  environment: PlaidConfig["environment"],
): string | undefined {
  if (!value) {
    if (environment === "sandbox") return undefined;
    throw new IntegrationError(
      "Plaid",
      "NOT_CONFIGURED",
      "Set PLAID_REDIRECT_URI to the registered HTTPS OAuth redirect before connecting production accounts.",
    );
  }
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    // Report configuration errors without including the configured URL.
  }
  const loopback =
    url &&
    (url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127\.\d+\.\d+\.\d+$/.test(url.hostname));
  if (
    !url ||
    value !== value.trim() ||
    url.username ||
    url.password ||
    value.includes("?") ||
    value.includes("#") ||
    (url.protocol !== "https:" &&
      !(environment === "sandbox" && url.protocol === "http:" && loopback))
  )
    throw new IntegrationError(
      "Plaid",
      "NOT_CONFIGURED",
      "PLAID_REDIRECT_URI must be an absolute HTTPS URL without credentials, query parameters, or a fragment; sandbox also supports HTTP loopback URLs.",
    );
  return value;
}

export const bankAccountSchema = z.object({
  accountId: providerIdSchema,
  name: z.string().min(1).max(1024),
  officialName: z.string().max(1024).nullable(),
  mask: z.string().max(20).nullable(),
  type: z.string().min(1).max(64),
  subtype: z.string().max(100).nullable(),
  currentBalance: z.number().finite().nullable(),
  availableBalance: z.number().finite().nullable(),
  currency: z.string().max(20).nullable(),
});
export type BankAccount = z.infer<typeof bankAccountSchema>;

const rawAccountSchema = z.object({
  account_id: providerIdSchema,
  name: bankAccountSchema.shape.name,
  official_name: bankAccountSchema.shape.officialName,
  mask: bankAccountSchema.shape.mask,
  type: bankAccountSchema.shape.type,
  subtype: bankAccountSchema.shape.subtype,
  balances: z.object({
    current: bankAccountSchema.shape.currentBalance,
    available: bankAccountSchema.shape.availableBalance,
    iso_currency_code: bankAccountSchema.shape.currency,
    unofficial_currency_code: bankAccountSchema.shape.currency,
  }),
});
const rawAccountsSchema = z.array(rawAccountSchema).max(1000);
function normalizeAccount(
  account: z.infer<typeof rawAccountSchema>,
): BankAccount {
  return {
    accountId: account.account_id,
    name: account.name,
    officialName: account.official_name,
    mask: account.mask,
    type: account.type,
    subtype: account.subtype,
    currentBalance: account.balances.current,
    availableBalance: account.balances.available,
    currency:
      account.balances.iso_currency_code ??
      account.balances.unofficial_currency_code,
  };
}
const accountsResponseSchema = z.object({
  accounts: rawAccountsSchema,
  item: z.object({
    institution_id: providerIdSchema.nullish(),
    institution_name: z.string().max(1024).nullish(),
  }),
});

// Transactions are read one at a time, so one unreadable record cannot hold
// back the page and with it every later update to the connection.
const syncPageSchema = z.object({
  accounts: rawAccountsSchema.default([]),
  added: z.array(z.unknown()).max(500),
  modified: z.array(z.unknown()).max(500),
  removed: z.array(z.unknown()).max(500),
  next_cursor: z.string().max(4096),
  has_more: z.boolean(),
  transactions_update_status: z.string().optional(),
  request_id: z.string().optional(),
});

const removedTransactionSchema = z.object({
  transaction_id: providerIdSchema,
  account_id: providerIdSchema,
});

function readSyncedTransactions(
  records: readonly unknown[],
  transactions: TransactionSyncDelta["added"],
  skipped: SkippedSyncRecords,
) {
  for (const record of records) {
    const result = readPlaidTransaction(record);
    if ("transaction" in result) transactions.push(result.transaction);
    else if ("quarantined" in result)
      skipped.quarantined.push(result.quarantined);
    else skipped.unidentifiable++;
  }
}

/** Sync records left out of the delta, which the update reports instead. */
export interface SkippedSyncRecords {
  quarantined: QuarantinedTransaction[];
  /** Records without a provider identity, which cannot be tracked at all. */
  unidentifiable: number;
}

const plaidErrorSchema = z.object({
  error_code: z
    .string()
    .regex(/^[A-Z_]+$/)
    .max(100),
});

export function createPlaidClient(
  config: PlaidConfig,
  fetcher: typeof fetch = fetch,
) {
  if (!config.clientId || !config.secret)
    throw new IntegrationError(
      "Plaid",
      "NOT_CONFIGURED",
      "Plaid client ID and secret are required.",
    );
  const environment = z
    .enum(["sandbox", "production"])
    .parse(config.environment);
  const redirectUri = validatePlaidRedirectUri(config.redirectUri, environment);
  const baseUrl =
    environment === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com";

  async function request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Plaid-Version": "2020-09-14",
      },
      body: JSON.stringify({
        ...body,
        client_id: config.clientId,
        secret: config.secret,
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const result = await readJsonResponse(response, "Plaid");
    if (!response.ok) {
      const error = plaidErrorSchema.safeParse(result);
      const code = error.success ? error.data.error_code : "REQUEST_FAILED";
      throw new IntegrationError(
        "Plaid",
        code,
        `Plaid request failed (${code}).`,
      );
    }
    return result;
  }

  return {
    async createLinkToken(
      clientUserId: string,
      accessToken?: string,
    ): Promise<{ linkToken: string; expiration: string }> {
      const result = z
        .object({
          link_token: z.string().min(1),
          expiration: z.string().datetime(),
        })
        .parse(
          await request("/link/token/create", {
            client_name: "Caishen",
            language: "en",
            country_codes: ["US"],
            ...(accessToken !== undefined
              ? {
                  access_token: z.string().min(1).max(2048).parse(accessToken),
                }
              : { products: ["transactions"] }),
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
            user: { client_user_id: providerIdSchema.parse(clientUserId) },
          }),
        );
      return { linkToken: result.link_token, expiration: result.expiration };
    },

    async exchangePublicToken(
      publicToken: string,
    ): Promise<{ accessToken: string; itemId: string }> {
      const result = z
        .object({
          access_token: z.string().min(1).max(2048),
          item_id: providerIdSchema,
        })
        .parse(
          await request("/item/public_token/exchange", {
            public_token: z.string().min(1).max(2048).parse(publicToken),
          }),
        );
      return { accessToken: result.access_token, itemId: result.item_id };
    },

    async getAccounts(accessToken: string): Promise<{
      accounts: BankAccount[];
      institutionId: string | null;
      institutionName: string | null;
    }> {
      const result = accountsResponseSchema.parse(
        await request("/accounts/get", {
          access_token: z.string().min(1).max(2048).parse(accessToken),
        }),
      );
      return {
        accounts: result.accounts.map(normalizeAccount),
        institutionId: result.item.institution_id ?? null,
        institutionName: result.item.institution_name ?? null,
      };
    },

    async syncTransactions(
      accessToken: string,
      cursor?: string | null,
    ): Promise<
      TransactionSyncDelta & {
        skipped: SkippedSyncRecords;
        nextCursor: string;
        updateStatus: string | null;
        accounts: BankAccount[];
      }
    > {
      z.string().min(1).max(2048).parse(accessToken);
      z.string().max(4096).nullish().parse(cursor);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const delta: TransactionSyncDelta = {
          added: [],
          modified: [],
          removed: [],
        };
        const skipped: SkippedSyncRecords = {
          quarantined: [],
          unidentifiable: 0,
        };
        let nextCursor = cursor ?? undefined;
        let updateStatus: string | null = null;
        const accounts = new Map<string, BankAccount>();
        try {
          for (let pageCount = 0; pageCount < 100; pageCount += 1) {
            const page = syncPageSchema.parse(
              await request("/transactions/sync", {
                access_token: accessToken,
                ...(nextCursor ? { cursor: nextCursor } : {}),
                count: 500,
              }),
            );
            for (const account of page.accounts.map(normalizeAccount)) {
              const previous = accounts.get(account.accountId);
              if (
                previous &&
                (previous.currentBalance !== account.currentBalance ||
                  previous.availableBalance !== account.availableBalance ||
                  previous.currency !== account.currency)
              )
                throw new IntegrationError(
                  "Plaid",
                  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
                  "Bank balances changed during the paginated update. No partial update was saved.",
                );
              accounts.set(account.accountId, account);
            }
            readSyncedTransactions(page.added, delta.added, skipped);
            readSyncedTransactions(page.modified, delta.modified, skipped);
            for (const entry of page.removed) {
              const removed = removedTransactionSchema.safeParse(entry);
              if (removed.success)
                delta.removed.push({
                  providerTransactionId: removed.data.transaction_id,
                  providerAccountId: removed.data.account_id,
                });
              else skipped.unidentifiable++;
            }
            updateStatus = page.transactions_update_status ?? updateStatus;
            if (!page.has_more)
              return {
                ...delta,
                skipped,
                nextCursor: page.next_cursor,
                updateStatus,
                accounts: [...accounts.values()],
              };
            if (!page.next_cursor || page.next_cursor === nextCursor)
              throw new IntegrationError(
                "Plaid",
                "INVALID_CURSOR",
                "Plaid pagination did not advance. No updates were saved.",
              );
            nextCursor = page.next_cursor;
          }
          throw new IntegrationError(
            "Plaid",
            "PAGE_LIMIT",
            "Plaid sync exceeded its page limit. No partial update was saved.",
          );
        } catch (error) {
          if (
            !(error instanceof IntegrationError) ||
            error.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" ||
            attempt === 2
          )
            throw error;
          // Plaid requires restarting the entire paginated update at the saved cursor.
        }
      }
      throw new IntegrationError(
        "Plaid",
        "SYNC_FAILED",
        "Plaid sync could not complete.",
      );
    },
  };
}
