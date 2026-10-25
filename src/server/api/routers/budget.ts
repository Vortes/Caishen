import {
  createPartnerInvite,
  checkPartnerInvite,
} from "~/server/services/partner-invites";
import {
  readEmailSubscription,
  setEmailSubscription,
} from "~/server/services/email-preferences";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { plaidLinkMetadataSchema } from "~/lib/plaid-link-metadata";
import {
  commandSchema,
  ledgerCommandSchema,
  projectBook,
} from "~/domain/engine";
import { personalSpendingEntries } from "~/domain/spending";
import { budgetDay } from "~/domain/user-command";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  submittedInputProcedure,
} from "~/server/api/trpc";
import { integrationStatus } from "~/server/integrations/status";
import { domainError } from "~/server/services/safety";
import { cancelScheduledDailyReviews } from "~/server/services/daily-delivery";
import {
  joinHousehold,
  onboard,
  setOnboardingCategories,
} from "~/server/services/household-operations";
import {
  executeCommand,
  openHousehold,
  type Database,
} from "~/server/services/household";
import { budgetMaintenance } from "~/server/services/stored-data";
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
  reconnectBank,
  disconnectBank,
  setupBankAccounts,
  bankLinkExitSchema,
  recordBankLinkExit,
} from "~/server/services/banks";
import { setupBankAccountsSchema } from "~/server/services/bank-account-setup";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const revision = z.number().int().nonnegative();
// The command as the client sent it, which identifies a retried operation.
const submittedCommand = z.object({ command: z.unknown() });
function currentMonth(zone: string) {
  return budgetDay(zone).slice(0, 7);
}
// A user's bank connections as the app reads them with their imports.
const savedBankConnections = (db: Database, userId: string) =>
  db.bankConnection.findMany({
    where: { clerkUserId: userId },
    select: {
      id: true,
      clerkUserId: true,
      itemId: true,
      lastSyncedAt: true,
      lastAttemptAt: true,
      error: true,
      accountMappings: true,
      unavailableAccountIds: true,
      imports: true,
    },
  });

// The partner's first name from their profile, which names the partner
// account in the shell.
async function partnerFirstName(
  db: Database,
  workspaceId: string,
  userId: string,
) {
  const partner = await db.workspaceMember.findFirst({
    where: { workspaceId, clerkUserId: { not: userId } },
    select: { user: { select: { firstName: true } } },
  });
  const name = partner?.user.firstName?.trim();
  // A blank name counts as none.
  return name === "" ? null : (name ?? null);
}

export const budgetRouter = createTRPCRouter({
  emailSubscription: publicProcedure
    .input(z.object({ token: z.string().max(2048) }))
    .query(({ ctx, input }) => readEmailSubscription(ctx.db, input.token)),
  setEmailSubscription: publicProcedure
    .input(z.object({ token: z.string().max(2048), enabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      setEmailSubscription(ctx.db, input.token, input.enabled),
    ),
  // What the app shell shows beside the rows it syncs (ADR 0006): whether
  // the budget can be read, and the bank connections with their inbox.
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [opened, savedConnections] = await Promise.all([
      openHousehold(ctx.db, ctx.userId, ctx.revision.observe),
      savedBankConnections(ctx.db, ctx.userId),
    ]);
    const services = integrationStatus(process.env);
    if (opened?.ledger.status !== "ready")
      return {
        // A budget that can't be read shows a maintenance message in place
        // of the plan, never partial numbers.
        status: opened ? ("maintenance" as const) : ("new" as const),
        services,
        connections: [],
        imports: [],
      };
    const imports = readImportStates(opened.household.rows, ctx.userId);
    const banks = savedConnections.map((connection) =>
      readBankConnection(connection, imports),
    );
    return {
      status: "ready" as const,
      services,
      connections: banks.map(bankConnectionView),
      imports: bankInboxItems(banks, opened.ledger.budget, opened.ledger.state),
      partnerFirstName: await partnerFirstName(
        ctx.db,
        opened.household.workspaceId,
        ctx.userId,
      ),
    };
  }),

  state: protectedProcedure
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const [opened, savedConnections] = await Promise.all([
        openHousehold(ctx.db, ctx.userId, ctx.revision.observe),
        savedBankConnections(ctx.db, ctx.userId),
      ]);
      const services = integrationStatus(process.env);
      if (opened?.ledger.status !== "ready")
        return {
          // A budget that can't be read shows a maintenance message in place
          // of the plan, never partial numbers.
          status: opened ? ("maintenance" as const) : ("new" as const),
          view: null,
          revision: opened?.household.revision ?? 0,
          services,
          connections: [],
          imports: [],
        };
      const { household, ledger } = opened;
      const imports = readImportStates(household.rows, ctx.userId);
      const banks = savedConnections.map((connection) =>
        readBankConnection(connection, imports),
      );
      const connections = banks.map(bankConnectionView);
      try {
        return {
          status: "ready" as const,
          view: projectBook(
            ledger.state,
            ctx.userId,
            input.month,
            currentMonth(ledger.budget.settings.timezone),
          ),
          revision: household.revision,
          services,
          connections,
          imports: bankInboxItems(banks, ledger.budget, ledger.state),
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
        emailEnabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      onboard(ctx.db, ctx.userId, input, ctx.revision.observe),
    ),

  setupCategories: protectedProcedure
    .input(
      z.object({
        operationId: z.string().min(1).max(200),
        expectedRevision: revision,
        categories: z
          .array(
            z.object({
              categoryId: z.string().startsWith("setup:").max(200),
              name: z.string().trim().min(1).max(120),
              group: z.string().max(120),
            }),
          )
          .max(500),
      }),
    )
    .mutation(({ ctx, input }) =>
      setOnboardingCategories(ctx.db, ctx.userId, input, ctx.revision.observe),
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
      let emailDisabled =
        input.command.type === "settings.update" &&
        input.command.emailEnabled === false;
      if (input.command.type === "revert") {
        const opened = await openHousehold(ctx.db, ctx.userId);
        emailDisabled =
          opened?.ledger.status === "ready" &&
          !opened.ledger.budget.settings.emailEnabled;
      }
      if (emailDisabled) {
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

  invite: protectedProcedure.mutation(({ ctx }) =>
    createPartnerInvite(ctx.db, ctx.userId),
  ),

  checkInvite: protectedProcedure
    .input(z.object({ code: z.string().trim().min(8).max(100) }))
    .mutation(({ ctx, input }) =>
      checkPartnerInvite(ctx.db, ctx.userId, input.code),
    ),

  join: protectedProcedure
    .input(z.object({ code: z.string().trim().min(8).max(100) }))
    .mutation(({ ctx, input }) =>
      joinHousehold(ctx.db, ctx.userId, input.code, ctx.revision.observe),
    ),

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
    .input(
      z.object({
        publicToken: z.string().min(1).max(2048),
        metadata: plaidLinkMetadataSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      exchangeBankToken(ctx.db, ctx.userId, input.publicToken, input.metadata),
    ),
  plaidLinkExit: protectedProcedure
    .input(bankLinkExitSchema)
    .mutation(({ ctx, input }) =>
      recordBankLinkExit(ctx.db, ctx.userId, input),
    ),
  plaidReconnect: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1).max(256) }))
    .mutation(({ ctx, input }) =>
      reconnectBank(ctx.db, ctx.userId, input.connectionId),
    ),
  disconnectBank: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().min(1).max(256),
        operationId: z.string().uuid(),
        expectedRevision: revision,
      }),
    )
    .mutation(({ ctx, input }) => disconnectBank(ctx.db, ctx.userId, input)),
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
