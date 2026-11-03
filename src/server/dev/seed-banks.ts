import { projectBook } from "~/domain/engine";
import type { Prisma } from "~/generated/prisma";
import type {
  ImportedTransaction,
  StoredImport,
} from "~/server/integrations/transactions";
import { bankImportFingerprint } from "~/server/services/bank-account-setup";
import type { ImportRowState } from "~/server/services/bank-import-rows";
import type { DevelopmentSeed } from "./seed-scenarios";

export const developmentSeedBankCredential =
  "development-seed:no-bank-credential";

export function isDevelopmentSeedBank(connection: {
  id: string;
  encryptedToken: string;
}) {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL_ENV !== "production" &&
    /^dev-seed-v1-[a-f0-9]{24}:bank:[0-5]$/.test(connection.id) &&
    connection.encryptedToken === developmentSeedBankCredential
  );
}

const institutions = [
  { name: "Chase", accounts: ["checking"] },
  { name: "Discover", accounts: ["savings", "discover"] },
  { name: "American Express", accounts: ["amex"] },
] as const;

export const developmentSeedConnectionIds = (workspaceId: string) =>
  Array.from({ length: 6 }, (_, index) => `${workspaceId}:bank:${index}`);

function storedImport(
  connectionId: string,
  current: ImportedTransaction,
): StoredImport {
  return {
    id: `${connectionId}:${current.providerTransactionId}`,
    namespace: connectionId,
    providerTransactionIds: [current.providerTransactionId],
    current,
    categoryId: null,
    removed: false,
    matchStatus: "confirmed",
    history: [{ kind: "added", before: null, after: current }],
  };
}

export function buildDevelopmentSeedBanks(
  seed: DevelopmentSeed,
  workspaceId: string,
) {
  const at = new Date(`${seed.asOf}T20:00:00.000Z`);
  return Object.values(seed.book.budgets).flatMap((budget) => {
    const person = budget.userId === seed.userId ? 0 : 1;
    const view = projectBook(seed.book, budget.userId, seed.month);
    return institutions.map((institution, index) => {
      const connectionId = `${workspaceId}:bank:${person * 3 + index}`;
      const imports: ImportRowState = {
        records: [],
        resolved: {},
        errors: {},
        reviews: {},
      };
      const accounts: Prisma.BankAccountCreateWithoutConnectionInput[] =
        institution.accounts.map((accountId, accountIndex) => {
          const account = view.accounts.find(
            (account) => account.id === accountId,
          )!;
          const providerAccountId = `${connectionId}:${accountId}`;
          const transaction = budget.transactions.find(
            (transaction) =>
              transaction.accountId === accountId &&
              !transaction.removed &&
              transaction.kind === "purchase",
          );
          if (transaction) {
            const record = storedImport(connectionId, {
              provider: "plaid",
              providerTransactionId: `booked-${transaction.id}`,
              providerAccountId,
              pendingTransactionId: null,
              amountCents: -transaction.amount,
              currency: "USD",
              date: transaction.date,
              authorizedDate: null,
              name: transaction.payee,
              merchantName: transaction.payee,
              pending: transaction.status === "pending",
            });
            imports.records.push(record);
            imports.resolved[record.id] = {
              fingerprint: bankImportFingerprint(record),
              transactionId: transaction.id,
            };
          }
          return {
            id: providerAccountId,
            providerAccountId,
            persistentAccountId: `persistent:${providerAccountId}`,
            name: account.name,
            officialName: account.name,
            mask: `${person + 1}${index + 1}${accountIndex + 1}0`,
            type: account.kind === "credit" ? "credit" : "depository",
            subtype: account.kind === "credit" ? "credit card" : accountId,
            currency: "USD",
            currentBalance:
              (account.kind === "credit" ? -account.cleared : account.cleared) /
              100,
            availableBalance:
              account.kind === "credit" ? null : account.cleared / 100,
            balancesAsOf: at,
            status: accountId === "discover" ? "unavailable" : "shared",
            historyComplete: true,
            link: {
              create: {
                workspaceId,
                userId: budget.userId,
                accountId,
                startDate: account.date,
                openingSnapshot: { postedImportIds: [], fingerprints: {} },
              },
            },
          };
        });
      if (index === 0) {
        accounts.push({
          id: `${connectionId}:new-card`,
          providerAccountId: `${connectionId}:new-card`,
          name: "Demo · Chase Freedom",
          officialName: "Demo · Chase Freedom",
          mask: "4321",
          type: "credit",
          subtype: "credit card",
          currency: "USD",
          currentBalance: 125,
          balancesAsOf: at,
          historyComplete: true,
        });
        const record = storedImport(connectionId, {
          provider: "plaid",
          providerTransactionId: "possible-duplicate-payment",
          providerAccountId: `${connectionId}:checking`,
          pendingTransactionId: null,
          amountCents: 30000,
          currency: "USD",
          date: seed.asOf,
          authorizedDate: null,
          name: "Demo · possible duplicate payment",
          merchantName: null,
          pending: false,
        });
        record.matchStatus = "needs_review";
        imports.records.push(record);
        imports.errors[record.id] =
          "Check whether this matches the credit card payment already in your register.";
      }
      const data = {
        id: connectionId,
        clerkUserId: budget.userId,
        itemId: `${connectionId}:item`,
        encryptedToken: developmentSeedBankCredential,
        status: index === 2 ? "login_required" : "connected",
        error:
          index === 2 ? "Demo · this bank needs you to sign in again." : null,
        newAccountsAvailable: index === 0,
        lastSyncedAt: at,
        lastSuccessfulUpdateAt: at,
        imports: {
          institutionId: `dev-seed:${index}`,
          institutionName: `Demo · ${institution.name}`,
          transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
        },
        bankAccounts: { create: accounts },
      } satisfies Prisma.BankConnectionUncheckedCreateInput;
      return { data, imports };
    });
  });
}
