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
  /**
   * Plaid's identity for the account across Items and account_id changes,
   * reported only by institutions with tokenized account numbers.
   */
  persistentAccountId: providerIdSchema.optional(),
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
  persistent_account_id: providerIdSchema.nullish(),
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
    ...(account.persistent_account_id
      ? { persistentAccountId: account.persistent_account_id }
      : {}),
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
// Every Plaid response body, including errors, names its request.
const requestIdSchema = z.object({ request_id: z.string().min(1).max(256) });

/** One Plaid request as the audit trail records it: never its body. */
export interface PlaidRequestEvent {
  path: string;
  requestId: string | null;
  errorCode: string | null;
  durationMs: number;
}
export type PlaidRequestRecorder = (event: PlaidRequestEvent) => Promise<void>;

// /item/get: the Item's consent and update health. Unknown fields are left
// alone; the error is read for its code only.
const itemResponseSchema = z.object({
  item: z.object({
    consent_expiration_time: z.string().datetime().nullish(),
    error: plaidErrorSchema.nullish(),
  }),
  status: z
    .object({
      transactions: z
        .object({
          last_successful_update: z.string().datetime().nullish(),
          last_failed_update: z.string().datetime().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
export interface PlaidItemHealth {
  errorCode: string | null;
  consentExpiresAt: Date | null;
  lastSuccessfulUpdateAt: Date | null;
  lastFailedUpdateAt: Date | null;
}
const instant = (value: string | null | undefined) =>
  value ? new Date(value) : null;

export function createPlaidClient(
  config: PlaidConfig,
  fetcher: typeof fetch = fetch,
  recorder?: PlaidRequestRecorder,
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

  // The audit trail must never fail a bank operation, so a failed event
  // write is the one error this adapter swallows; it is logged instead.
  async function record(event: PlaidRequestEvent) {
    if (!recorder) return;
    try {
      await recorder(event);
    } catch (error) {
      console.error("Plaid request could not be recorded", {
        ...event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const started = performance.now();
    let requestId: string | null = null;
    let errorCode: string | null = null;
    try {
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
      const identified = requestIdSchema.safeParse(result);
      requestId = identified.success ? identified.data.request_id : null;
      if (!response.ok) {
        const error = plaidErrorSchema.safeParse(result);
        const code = error.success ? error.data.error_code : "REQUEST_FAILED";
        throw new IntegrationError(
          "Plaid",
          code,
          `Plaid request failed (${code}).`,
          requestId,
        );
      }
      return result;
    } catch (error) {
      errorCode =
        error instanceof IntegrationError
          ? error.code
          : error instanceof Error
            ? error.name
            : "REQUEST_FAILED";
      throw error;
    } finally {
      await record({
        path,
        requestId,
        errorCode,
        durationMs: Math.round(performance.now() - started),
      });
    }
  }

  return {
    async removeItem(accessToken: string): Promise<void> {
      try {
        await request("/item/remove", {
          access_token: z.string().min(1).max(2048).parse(accessToken),
        });
      } catch (error) {
        if (
          !(error instanceof IntegrationError) ||
          error.code !== "ITEM_NOT_FOUND"
        )
          throw error;
      }
    },
    async updateWebhook(accessToken: string, webhook: string): Promise<void> {
      await request("/item/webhook/update", {
        access_token: z.string().min(1).max(2048).parse(accessToken),
        webhook: z.string().url().parse(webhook),
      });
    },
    async getItem(accessToken: string): Promise<PlaidItemHealth> {
      const result = itemResponseSchema.parse(
        await request("/item/get", {
          access_token: z.string().min(1).max(2048).parse(accessToken),
        }),
      );
      return {
        errorCode: result.item.error?.error_code ?? null,
        consentExpiresAt: instant(result.item.consent_expiration_time),
        lastSuccessfulUpdateAt: instant(
          result.status?.transactions?.last_successful_update,
        ),
        lastFailedUpdateAt: instant(
          result.status?.transactions?.last_failed_update,
        ),
      };
    },
    async getWebhookVerificationKey(keyId: string): Promise<unknown> {
      const result = z.object({ key: z.unknown() }).parse(
        await request("/webhook_verification_key/get", {
          key_id: z.string().min(1).max(256).parse(keyId),
        }),
      );
      return result.key;
    },
    async createLinkToken(
      clientUserId: string,
      accessToken?: string,
      webhook?: string,
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
                  update: { account_selection_enabled: true },
                }
              : { products: ["transactions"] }),
            ...(redirectUri ? { redirect_uri: redirectUri } : {}),
            ...(webhook ? { webhook: z.string().url().parse(webhook) } : {}),
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
