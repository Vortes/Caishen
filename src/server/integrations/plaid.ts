import { z } from "zod";

import {
  normalizePlaidTransaction,
  plaidTransactionSchema,
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
}

const syncPageSchema = z.object({
  added: z.array(plaidTransactionSchema).max(500),
  modified: z.array(plaidTransactionSchema).max(500),
  removed: z
    .array(
      z.object({
        transaction_id: providerIdSchema,
        account_id: providerIdSchema,
      }),
    )
    .max(500),
  next_cursor: z.string().max(4096),
  has_more: z.boolean(),
  transactions_update_status: z.string().optional(),
  request_id: z.string().optional(),
});

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
            products: ["transactions"],
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

    async syncTransactions(
      accessToken: string,
      cursor?: string | null,
    ): Promise<
      TransactionSyncDelta & { nextCursor: string; updateStatus: string | null }
    > {
      z.string().min(1).max(2048).parse(accessToken);
      z.string().max(4096).nullish().parse(cursor);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const delta: TransactionSyncDelta = {
          added: [],
          modified: [],
          removed: [],
        };
        let nextCursor = cursor ?? undefined;
        let updateStatus: string | null = null;
        try {
          for (let pageCount = 0; pageCount < 100; pageCount += 1) {
            const page = syncPageSchema.parse(
              await request("/transactions/sync", {
                access_token: accessToken,
                ...(nextCursor ? { cursor: nextCursor } : {}),
                count: 500,
              }),
            );
            delta.added.push(...page.added.map(normalizePlaidTransaction));
            delta.modified.push(
              ...page.modified.map(normalizePlaidTransaction),
            );
            delta.removed.push(
              ...page.removed.map((entry) => ({
                providerTransactionId: entry.transaction_id,
                providerAccountId: entry.account_id,
              })),
            );
            updateStatus = page.transactions_update_status ?? updateStatus;
            if (!page.has_more)
              return { ...delta, nextCursor: page.next_cursor, updateStatus };
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
