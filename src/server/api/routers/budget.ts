import { TRPCError } from "@trpc/server";
import { randomBytes } from "node:crypto";
import { z, type ZodError } from "zod";
import {
  commandSchema,
  ledgerCommandSchema,
  projectBook,
} from "~/domain/engine";
import { personalSpendingEntries } from "~/domain/spending";
import { budgetDay } from "~/domain/user-command";
import {
  createTRPCRouter,
  protectedProcedure,
  submittedInputProcedure,
} from "~/server/api/trpc";
import { parseCategoryImport } from "~/server/categories";
import { createOpenRouterProvider } from "~/server/integrations/model";
import { integrationStatus } from "~/server/integrations/status";
import {
  parseStatementCsv,
  reconcileStatement,
  savedReconciliationResult,
} from "~/server/integrations/reconciliation";
import { dateSchema, centsSchema } from "~/server/integrations/validation";
import { commandHash, domainError, jsonValue } from "~/server/services/safety";
import { cancelScheduledDailyReviews } from "~/server/services/daily-delivery";
import {
  approveSuggestions,
  importCategories,
  joinHousehold,
  onboard,
} from "~/server/services/household-operations";
import {
  executeCommand,
  openHousehold,
  requireHousehold,
} from "~/server/services/household";
import { changeHistory, historySummary } from "~/server/services/history";
import {
  budgetMaintenance,
  reportUnreadable,
  zodIssues,
} from "~/server/services/stored-data";
import { readImportStates } from "~/server/services/bank-import-rows";
import { readHouseholdRevision } from "~/server/storage/rows";
import {
  bankInboxItems,
  bankConnectionView,
  readBankConnection,
  exchangeBankToken,
  linkBankToken,
  syncBanks,
  resolveImport,
  mapBankAccount,
  reconnectBank,
  setupBankAccounts,
} from "~/server/services/banks";
import { setupBankAccountsSchema } from "~/server/services/bank-account-setup";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const revision = z.number().int().nonnegative();
// The command as the client sent it, which identifies a retried operation.
const submittedCommand = z.object({ command: z.unknown() });
function currentMonth(zone: string) {
  return budgetDay(zone).slice(0, 7);
}
const evidenceAlert =
  (evidenceId: string, userId: string) => (error: ZodError) =>
    reportUnreadable({ record: "ReviewEvidence.result", evidenceId, userId }, [
      { issues: zodIssues(error) },
    ]);

export const budgetRouter = createTRPCRouter({
  state: protectedProcedure
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const [opened, savedConnections, evidence] = await Promise.all([
        openHousehold(ctx.db, ctx.userId, ctx.revision.observe),
        ctx.db.bankConnection.findMany({
          where: { clerkUserId: ctx.userId },
          select: {
            id: true,
            clerkUserId: true,
            itemId: true,
            lastSyncedAt: true,
            lastAttemptAt: true,
            error: true,
            accountMappings: true,
            imports: true,
          },
        }),
        ctx.db.reviewEvidence.findMany({
          where: { clerkUserId: ctx.userId },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            accountId: true,
            cutoff: true,
            result: true,
            evidence: true,
            createdAt: true,
          },
        }),
      ]);
      const services = integrationStatus(process.env);
      if (opened?.ledger.status !== "ready")
        return {
          // A budget that can't be read shows a maintenance message in place
          // of the plan, never partial numbers.
          status: opened ? ("maintenance" as const) : ("new" as const),
          view: null,
          revision: opened?.household.revision ?? 0,
          history: { undo: null, redo: null },
          services,
          connections: [],
          evidence: [],
          imports: [],
        };
      const { household, ledger } = opened;
      const imports = readImportStates(household.rows, ctx.userId);
      const banks = savedConnections.map((connection) =>
        readBankConnection(connection, imports),
      );
      const connections = banks.map(bankConnectionView);
      try {
        const currentEvidence = evidence.map(
          ({ evidence: savedEvidence, result, ...item }) => ({
            ...item,
            result: savedReconciliationResult(
              result,
              savedEvidence,
              household.revision,
              evidenceAlert(item.id, ctx.userId),
            ),
          }),
        );
        return {
          status: "ready" as const,
          view: projectBook(
            ledger.state,
            ctx.userId,
            input.month,
            currentMonth(ledger.budget.settings.timezone),
          ),
          revision: household.revision,
          history: await historySummary(ctx.db, household, ctx.userId),
          services,
          connections,
          evidence: currentEvidence,
          imports: bankInboxItems(banks, ledger.budget),
        };
      } catch (error) {
        domainError(error);
      }
    }),

  // Every month of personal spending, for reports that filter and group it
  // on the client.
  spending: protectedProcedure.query(async ({ ctx }) => {
    const opened = await openHousehold(
      ctx.db,
      ctx.userId,
      ctx.revision.observe,
    );
    if (!opened) return { entries: [] };
    if (opened.ledger.status !== "ready") throw budgetMaintenance();
    try {
      return {
        entries: personalSpendingEntries(opened.ledger.state, ctx.userId),
      };
    } catch (error) {
      domainError(error);
    }
  }),

  onboard: submittedInputProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        month,
        timezone: z.string().max(100),
      }),
    )
    .mutation(({ ctx, input }) =>
      onboard(ctx.db, ctx.userId, input, ctx.revision.observe),
    ),

  execute: submittedInputProcedure
    .input(
      z.object({
        command: ledgerCommandSchema,
        baseRevision: revision,
        clientId: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { command: submitted } = submittedCommand.parse(ctx.submittedInput);
      const result = await executeCommand(
        ctx.db,
        ctx.userId,
        {
          command: input.command,
          submitted,
          baseRevision: input.baseRevision,
        },
        ctx.revision.observe,
      );
      if (
        input.command.type === "settings.update" &&
        input.command.emailEnabled === false
      ) {
        try {
          await cancelScheduledDailyReviews(ctx.db, ctx.userId);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Your settings were saved, but queued email could not be canceled. Try saving again.",
          });
        }
      }
      return result;
    }),

  changeHistory: protectedProcedure
    .input(
      z.object({
        direction: z.enum(["undo", "redo"]),
        expectedRevision: revision,
        operationId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await changeHistory(
        ctx.db,
        ctx.userId,
        input,
        ctx.revision.observe,
      );
      let warning: string | null = null;
      try {
        const opened = await openHousehold(ctx.db, ctx.userId);
        if (
          opened?.ledger.status === "ready" &&
          !opened.ledger.budget.settings.emailEnabled
        )
          await cancelScheduledDailyReviews(ctx.db, ctx.userId);
      } catch {
        warning =
          "Your change was saved, but queued email could not be checked. Review your email preferences in Settings.";
      }
      return { ...result, warning };
    }),

  approveSuggestions: submittedInputProcedure
    .input(
      z.object({
        operationId: z.string().uuid(),
        expectedRevision: revision,
        items: z
          .array(
            z.object({
              transactionId: z.string().min(1).max(256),
              categoryId: z.string().min(1).max(256),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .mutation(({ ctx, input }) =>
      approveSuggestions(
        ctx.db,
        ctx.userId,
        input,
        ctx.submittedInput,
        ctx.revision.observe,
      ),
    ),

  importCategories: protectedProcedure
    .input(
      z.object({ text: z.string().max(1_000_000), expectedRevision: revision }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await importCategories(
          ctx.db,
          ctx.userId,
          {
            categories: parseCategoryImport(input.text).map((category) => ({
              categoryId: `ynab:${commandHash(category).slice(0, 32)}`,
              ...category,
            })),
            expectedRevision: input.expectedRevision,
          },
          ctx.revision.observe,
        );
      } catch (error) {
        domainError(error);
      }
    }),

  invite: protectedProcedure.mutation(async ({ ctx }) => {
    const member = await ctx.db.workspaceMember.findUnique({
      where: { clerkUserId: ctx.userId },
    });
    if (!member)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Create a budget before inviting your partner.",
      });
    const count = await ctx.db.workspaceMember.count({
      where: { workspaceId: member.workspaceId },
    });
    if (count >= 2)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Your partner is already connected.",
      });
    const code = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await ctx.db.partnerInvite.create({
      data: {
        tokenHash: commandHash(code),
        workspaceId: member.workspaceId,
        createdBy: ctx.userId,
        expiresAt,
      },
    });
    return { code, expiresAt };
  }),

  join: protectedProcedure
    .input(z.object({ code: z.string().trim().min(20).max(100) }))
    .mutation(({ ctx, input }) =>
      joinHousehold(ctx.db, ctx.userId, input.code, ctx.revision.observe),
    ),

  suggest: protectedProcedure
    .input(z.object({ transactionIds: z.array(z.string()).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const {
        ledger: { budget },
      } = await requireHousehold(ctx.db, ctx.userId, ctx.revision.observe);
      const transactions = budget.transactions.filter(
        (t) =>
          !t.removed &&
          t.kind === "purchase" &&
          input.transactionIds.includes(t.id),
      );
      if (transactions.length !== new Set(input.transactionIds).size)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Only your own active purchases can be sent for suggestions.",
        });
      try {
        return await createOpenRouterProvider({
          apiKey: process.env.OPENROUTER_API_KEY ?? "",
          model: process.env.OPENROUTER_MODEL ?? "",
        }).suggestCategories({
          categories: budget.categories
            .filter((c) => !c.pairedAccountId && !c.pairedLoanId)
            .map((c) => ({ id: c.id, name: c.name })),
          transactions: transactions.map((t) => ({
            id: t.id,
            merchant: t.payee,
            date: t.date,
            amountCents: -t.amount,
          })),
        });
      } catch (error) {
        domainError(error);
      }
    }),

  reconcile: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        periodStart: dateSchema,
        cutoff: dateSchema,
        openingBalanceCents: centsSchema,
        closingBalanceCents: centsSchema,
        csv: z.string().max(1_000_000),
        verified: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        household,
        ledger: { budget },
      } = await requireHousehold(ctx.db, ctx.userId, ctx.revision.observe);
      const account = budget.accounts.find((a) => a.id === input.accountId);
      if (!account)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found.",
        });
      if (input.periodStart < account.date)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The statement starts before this account's opening ledger balance.",
        });
      try {
        const activity = budget.transactions.filter(
          (t) =>
            t.accountId === account.id && !t.removed && t.status === "posted",
        );
        const openingBalanceCents =
          account.openingBalance +
          activity
            .filter((t) => t.date < input.periodStart)
            .reduce((sum, t) => sum + t.amount, 0);
        const periodActivity = activity
          .filter((t) => t.date >= input.periodStart && t.date <= input.cutoff)
          .map((t) => ({
            date: t.date,
            description: t.payee,
            amountCents: t.amount,
            ...(t.providerId ? { reference: t.providerId } : {}),
          }));
        const evidence = {
          accountId: account.id,
          currency: "USD" as const,
          periodStart: input.periodStart,
          cutoff: input.cutoff,
          openingBalanceCents: input.openingBalanceCents,
          closingBalanceCents: input.closingBalanceCents,
          activity: parseStatementCsv(input.csv),
          balanceKind: "cleared" as const,
          source: "statement" as const,
          verified: input.verified,
          activityComplete: input.verified,
        };
        const result = reconcileStatement(
          {
            accountId: account.id,
            currency: "USD",
            periodStart: input.periodStart,
            cutoff: input.cutoff,
            openingBalanceCents,
            closingBalanceCents:
              openingBalanceCents +
              periodActivity.reduce((sum, t) => sum + t.amountCents, 0),
            activity: periodActivity,
            balanceKind: "cleared",
          },
          evidence,
        );
        await ctx.db.reviewEvidence.create({
          data: {
            clerkUserId: ctx.userId,
            accountId: account.id,
            kind: "statement",
            cutoff: input.cutoff,
            evidence: jsonValue({
              ...evidence,
              csvHash: commandHash(input.csv),
              attestedBy: ctx.userId,
              revision: household.revision,
            }),
            result: jsonValue(result),
          },
        });
        return {
          ...result,
          revision: household.revision,
          changeSet: null,
          rebased: false as const,
        };
      } catch (error) {
        domainError(error);
      }
    }),

  plaidLinkToken: protectedProcedure
    .input(
      z
        .object({ connectionId: z.string().min(1).max(256).optional() })
        .optional(),
    )
    .mutation(({ ctx, input }) =>
      linkBankToken(ctx.db, ctx.userId, input?.connectionId),
    ),
  plaidExchange: protectedProcedure
    .input(z.object({ publicToken: z.string().min(1).max(2048) }))
    .mutation(({ ctx, input }) =>
      exchangeBankToken(ctx.db, ctx.userId, input.publicToken),
    ),
  plaidReconnect: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1).max(256) }))
    .mutation(({ ctx, input }) =>
      reconnectBank(ctx.db, ctx.userId, input.connectionId),
    ),
  mapBankAccount: protectedProcedure
    .input(
      z.object({
        connectionId: z.string(),
        providerAccountId: z.string(),
        accountId: z.string(),
        startDate: dateSchema,
      }),
    )
    .mutation(({ ctx, input }) => mapBankAccount(ctx.db, ctx.userId, input)),
  setupBankAccounts: submittedInputProcedure
    .input(setupBankAccountsSchema)
    .mutation(({ ctx, input }) =>
      setupBankAccounts(ctx.db, ctx.userId, input, ctx.submittedInput),
    ),
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    const counts = await syncBanks(ctx.db, ctx.userId);
    const household = await readHouseholdRevision(ctx.db, ctx.userId);
    if (household) ctx.revision.observe(household.revision);
    // Each connection's update is its own operation: the browser pulls.
    return {
      ...counts,
      revision: household?.revision ?? 0,
      changeSet: null,
      rebased: false as const,
    };
  }),
  resolveImport: submittedInputProcedure
    .input(
      z.object({
        connectionId: z.string(),
        logicalId: z.string(),
        expectedFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        command: commandSchema.optional(),
        existingTransactionId: z.string().optional(),
        expectedRevision: revision,
        ignore: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      resolveImport(ctx.db, ctx.userId, {
        ...input,
        submittedCommand: submittedCommand.parse(ctx.submittedInput).command,
      }),
    ),
});
