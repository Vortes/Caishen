import { TRPCError } from "@trpc/server";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "~/generated/prisma";
import {
  bookSchema,
  commandSchema,
  createBook,
  execute,
  mergeBooks,
  projectBook,
  type Book,
  type Command,
} from "~/domain/engine";
import { personalSpendingEntries } from "~/domain/spending";
import { budgetDay, prepareUserCommand } from "~/domain/user-command";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
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
  changeWorkspaceHistory,
  mutateWorkspace,
  readWorkspace,
} from "~/server/services/workspace";
import { historySummary } from "~/server/services/workspace-history";
import {
  bankInbox,
  bankAccountDetails,
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
function currentMonth(zone: string) {
  return budgetDay(zone).slice(0, 7);
}
function parseBook(value: unknown): Book {
  return bookSchema.parse(value);
}

export const budgetRouter = createTRPCRouter({
  state: protectedProcedure
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const [member, savedConnections, evidence, imports] = await Promise.all([
        readWorkspace(ctx.db, ctx.userId),
        ctx.db.bankConnection.findMany({
          where: { clerkUserId: ctx.userId },
          select: {
            id: true,
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
        bankInbox(ctx.db, ctx.userId),
      ]);
      const connections = savedConnections.map(
        ({ imports, ...connection }) => ({
          ...connection,
          ...bankAccountDetails(imports),
        }),
      );
      if (!member)
        return {
          view: null,
          revision: 0,
          history: { undo: null, redo: null },
          services: integrationStatus(process.env),
          connections,
          evidence: [],
          imports,
        };
      const book = parseBook(member.workspace.book);
      const budget = book.budgets[ctx.userId]!;
      try {
        const currentEvidence = evidence.map(
          ({ evidence: savedEvidence, result, ...item }) => ({
            ...item,
            result: savedReconciliationResult(
              result,
              savedEvidence,
              member.workspace.revision,
            ),
          }),
        );
        return {
          view: projectBook(
            book,
            ctx.userId,
            input.month,
            currentMonth(budget.settings.timezone),
          ),
          revision: member.workspace.revision,
          history: historySummary(
            member.workspace.history,
            ctx.userId,
            member.workspace.revision,
          ),
          services: integrationStatus(process.env),
          connections,
          evidence: currentEvidence,
          imports,
        };
      } catch (error) {
        domainError(error);
      }
    }),

  // Every month of personal spending, for reports that filter and group it
  // on the client.
  spending: protectedProcedure.query(async ({ ctx }) => {
    const member = await readWorkspace(ctx.db, ctx.userId);
    if (!member) return { entries: [] };
    try {
      return {
        entries: personalSpendingEntries(
          parseBook(member.workspace.book),
          ctx.userId,
        ),
      };
    } catch (error) {
      domainError(error);
    }
  }),

  onboard: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        month,
        timezone: z.string().max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const base = createBook(ctx.userId, input.name, input.month);
        const book = execute(base, ctx.userId, {
          type: "settings.update",
          id: randomUUID(),
          timezone: input.timezone,
        });
        await ctx.db.workspace.create({
          data: {
            book: jsonValue(book),
            members: { create: { clerkUserId: ctx.userId } },
          },
        });
        return { revision: 0 };
      } catch (error) {
        domainError(error);
      }
    }),

  execute: protectedProcedure
    .input(z.object({ command: commandSchema, expectedRevision: revision }))
    .mutation(async ({ ctx, input }) => {
      const result = await mutateWorkspace(
        ctx.db,
        ctx.userId,
        input.expectedRevision,
        [input.command],
        "user",
        (value, commands) => {
          let book = parseBook(value);
          for (const command of commands) {
            const budget = book.budgets[ctx.userId]!;
            book = execute(
              book,
              ctx.userId,
              prepareUserCommand(budget, command),
            );
          }
          return book;
        },
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
      const result = await changeWorkspaceHistory(ctx.db, ctx.userId, input);
      let warning: string | null = null;
      try {
        const member = await readWorkspace(ctx.db, ctx.userId);
        const budget =
          member && parseBook(member.workspace.book).budgets[ctx.userId];
        if (budget && !budget.settings.emailEnabled)
          await cancelScheduledDailyReviews(ctx.db, ctx.userId);
      } catch {
        warning =
          "Your change was saved, but queued email could not be checked. Review your email preferences in Settings.";
      }
      return { ...result, warning };
    }),

  approveSuggestions: protectedProcedure
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
    .mutation(async ({ ctx, input }) => {
      if (
        new Set(input.items.map((item) => item.transactionId)).size !==
        input.items.length
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose each purchase only once.",
        });
      const commands: Command[] = input.items.map((item) => ({
        type: "transaction.categorize",
        id: `${input.operationId}:${commandHash(item).slice(0, 32)}`,
        ...item,
      }));
      return mutateWorkspace(
        ctx.db,
        ctx.userId,
        input.expectedRevision,
        commands,
        "user",
        (value, fresh) =>
          fresh.reduce(
            (book, command) => execute(book, ctx.userId, command),
            parseBook(value),
          ),
        "Approve suggested categories",
      );
    }),

  importCategories: protectedProcedure
    .input(
      z.object({ text: z.string().max(1_000_000), expectedRevision: revision }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const categories = parseCategoryImport(input.text);
        const command: Command = {
          type: "category.import",
          id: randomUUID(),
          categories: categories.map((category) => ({
            categoryId: `ynab:${commandHash(category).slice(0, 32)}`,
            ...category,
          })),
        };
        return await mutateWorkspace(
          ctx.db,
          ctx.userId,
          input.expectedRevision,
          [command],
          "user",
          (value, commands) =>
            commands.reduce(
              (book, cmd) => execute(book, ctx.userId, cmd),
              parseBook(value),
            ),
        );
      } catch (error) {
        domainError(error);
      }
    }),

  invite: protectedProcedure.mutation(async ({ ctx }) => {
    const member = await readWorkspace(ctx.db, ctx.userId);
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
    .mutation(async ({ ctx, input }) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await ctx.db.$transaction(
            async (tx) => {
              const invite = await tx.partnerInvite.findUnique({
                where: { tokenHash: commandHash(input.code) },
                include: { workspace: { include: { members: true } } },
              });
              if (!invite || invite.usedBy || invite.expiresAt < new Date())
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message:
                    "This invitation is invalid, expired, or already used.",
                });
              if (invite.createdBy === ctx.userId)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "Give this code to your partner to use in their own account.",
                });
              const member = await tx.workspaceMember.findUnique({
                where: { clerkUserId: ctx.userId },
                include: { workspace: true },
              });
              if (!member)
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "Create your own personal budget first.",
                });
              const book = mergeBooks(
                parseBook(invite.workspace.book),
                parseBook(member.workspace.book),
                ctx.userId,
              );
              const changed = await tx.workspace.updateMany({
                where: {
                  id: invite.workspaceId,
                  revision: invite.workspace.revision,
                },
                data: { book: jsonValue(book), revision: { increment: 1 } },
              });
              const sourceLocked = await tx.workspace.updateMany({
                where: {
                  id: member.workspaceId,
                  revision: member.workspace.revision,
                },
                data: { revision: { increment: 1 } },
              });
              if (changed.count !== 1 || sourceLocked.count !== 1)
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "A budget changed while joining. Try again.",
                });
              await tx.workspaceMember.update({
                where: { clerkUserId: ctx.userId },
                data: { workspaceId: invite.workspaceId },
              });
              await tx.partnerInvite.update({
                where: { id: invite.id },
                data: { usedBy: ctx.userId },
              });
              return { revision: invite.workspace.revision + 1 };
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
              timeout: 15_000,
            },
          );
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034" &&
            attempt < 2
          )
            continue;
          domainError(error);
        }
      }
      throw new TRPCError({
        code: "CONFLICT",
        message: "A budget changed while joining. Try again.",
      });
    }),

  suggest: protectedProcedure
    .input(z.object({ transactionIds: z.array(z.string()).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const member = await readWorkspace(ctx.db, ctx.userId);
      if (!member) throw new TRPCError({ code: "NOT_FOUND" });
      const budget = parseBook(member.workspace.book).budgets[ctx.userId]!;
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
      const member = await readWorkspace(ctx.db, ctx.userId);
      if (!member) throw new TRPCError({ code: "NOT_FOUND" });
      const budget = parseBook(member.workspace.book).budgets[ctx.userId]!;
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
              revision: member.workspace.revision,
            }),
            result: jsonValue(result),
          },
        });
        return result;
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
  setupBankAccounts: protectedProcedure
    .input(setupBankAccountsSchema)
    .mutation(({ ctx, input }) => setupBankAccounts(ctx.db, ctx.userId, input)),
  sync: protectedProcedure.mutation(({ ctx }) => syncBanks(ctx.db, ctx.userId)),
  resolveImport: protectedProcedure
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
    .mutation(({ ctx, input }) => resolveImport(ctx.db, ctx.userId, input)),
});
