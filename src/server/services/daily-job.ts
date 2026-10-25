import { clerkClient } from "@clerk/nextjs/server";
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import {
  buildDailyReviewMessage,
  createResendClient,
  dailyReviewSchedule,
} from "~/server/integrations/daily-review";
import { bankInbox, syncBanks } from "./banks";
import { purgeBankProviderEvents } from "./bank-provider-events";
import {
  cancelScheduledDailyReviews,
  claimDailyDelivery,
  dailyDeliveryPayloadSchema,
  type DailyDeliveryPayload,
  type DailyDeliveryTarget,
} from "./daily-delivery";
import { jsonValue } from "./safety";
import type { Budget } from "~/domain/engine";
import { openHousehold, type Database } from "./household";
import { budgetMaintenance, reportUnreadable, zodIssues } from "./stored-data";
import { emailPreferenceToken } from "./email-preferences";

/**
 * A member's budget and their household's revision, or null when they have
 * none. Refused while their plan is under maintenance.
 */
async function readBudget(
  db: Database,
  userId: string,
): Promise<{ budget: Budget; revision: number } | null> {
  const opened = await openHousehold(db, userId);
  if (!opened) return null;
  if (opened.ledger.status !== "ready") throw budgetMaintenance();
  return { budget: opened.ledger.budget, revision: opened.household.revision };
}

interface DailyJobDependencies {
  syncBanks: typeof syncBanks;
  bankInbox: typeof bankInbox;
  readBudget: typeof readBudget;
  verifiedEmail: (userId: string) => Promise<string>;
  send: (payload: DailyDeliveryPayload) => Promise<{ id: string }>;
  cancel: (
    db: Database,
    userId: string,
    now: Date,
  ) => Promise<{ canceled: number }>;
}

const defaultDependencies: DailyJobDependencies = {
  syncBanks,
  bankInbox,
  readBudget,
  cancel: cancelScheduledDailyReviews,
  async verifiedEmail(userId) {
    const user = await (await clerkClient()).users.getUser(userId);
    const email = user.emailAddresses.find(
      (address) =>
        address.id === user.primaryEmailAddressId &&
        address.verification?.status === "verified",
    )?.emailAddress;
    if (!email)
      throw new Error(
        "Verify your primary email in account settings before daily delivery.",
      );
    return email;
  },
  async send(payload) {
    return createResendClient({
      apiKey: process.env.RESEND_API_KEY!,
      from: payload.from,
    }).sendDailyReview(payload);
  },
};

async function preparePayload(
  db: Database,
  userId: string,
  target: DailyDeliveryTarget,
  now: Date,
  dependencies: DailyJobDependencies,
): Promise<DailyDeliveryPayload> {
  const [email, imports, freshness, read] = await Promise.all([
    dependencies.verifiedEmail(userId),
    dependencies.bankInbox(db, userId),
    db.bankConnection.findMany({
      where: { clerkUserId: userId },
      select: { lastSyncedAt: true },
    }),
    dependencies.readBudget(db, userId),
  ]);
  if (!read) throw new Error("The personal budget is no longer available.");
  const { budget } = read;
  if (!budget.settings.emailEnabled)
    throw new Error("Daily email has been disabled.");
  const inboxCount =
    budget.transactions.filter(
      (transaction) => !transaction.removed && !transaction.reviewed,
    ).length + imports.filter(bankImportNeedsReview).length;
  const allUpdated =
    freshness.length > 0 &&
    freshness.every((connection) => connection.lastSyncedAt);
  const oldestSync = allUpdated
    ? new Date(
        Math.min(
          ...freshness.map((connection) => connection.lastSyncedAt!.getTime()),
        ),
      )
    : null;
  const unsubscribe = new URL("/email/unsubscribe", process.env.APP_BASE_URL);
  unsubscribe.searchParams.set("token", emailPreferenceToken(userId));
  return dailyDeliveryPayloadSchema.parse({
    from: process.env.EMAIL_FROM,
    to: email,
    dedupeKey: target.dedupeKey,
    unsubscribeUrl: unsubscribe
      .toString()
      .replace("/email/unsubscribe?", "/api/email/unsubscribe?"),
    ...(new Date(target.scheduledAt) > now
      ? { scheduledAt: target.scheduledAt }
      : {}),
    message: buildDailyReviewMessage({
      appBaseUrl: process.env.APP_BASE_URL!,
      inboxCount,
      latestSuccessfulSync: oldestSync,
      timeZone: budget.settings.timezone,
      unsubscribeUrl: unsubscribe.toString(),
    }),
  });
}

function savedPayload(delivery: {
  id: string;
  clerkUserId: string;
  payload: unknown;
}) {
  const saved = dailyDeliveryPayloadSchema.safeParse(delivery.payload);
  if (saved.success) return saved.data;
  reportUnreadable(
    {
      record: "DailyDelivery.payload",
      deliveryId: delivery.id,
      userId: delivery.clerkUserId,
    },
    [{ issues: zodIssues(saved.error) }],
  );
  throw saved.error;
}

async function dailyEmailEnabled(
  db: Database,
  userId: string,
  dependencies: DailyJobDependencies,
) {
  const [user, read] = await Promise.all([
    db.user.findUnique({
      where: { clerkUserId: userId },
      select: { active: true },
    }),
    dependencies.readBudget(db, userId),
  ]);
  const budget = read?.budget;
  return !!(user?.active && budget?.settings.emailEnabled);
}

async function recoverDailyCancellations(
  db: Database,
  now: Date,
  dependencies: DailyJobDependencies,
) {
  let canceled = 0,
    failed = 0;
  let cursor: string | undefined;
  const owners = new Set<string>();
  for (;;) {
    const deliveries = await db.dailyDelivery.findMany({
      where: {
        scheduledAt: { gt: now },
        ...(cursor ? { id: { gt: cursor } } : {}),
        OR: [
          { status: "scheduled", providerId: { not: null } },
          { status: "preparing", providerId: null, firstAttemptAt: null },
          {
            status: { in: ["preparing", "sending", "failed", "unknown"] },
            providerId: null,
            firstAttemptAt: { not: null },
          },
        ],
      },
      select: { id: true, clerkUserId: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    for (const delivery of deliveries) {
      if (owners.has(delivery.clerkUserId)) continue;
      owners.add(delivery.clerkUserId);
      try {
        if (
          !(await dailyEmailEnabled(db, delivery.clerkUserId, dependencies))
        ) {
          const result = await dependencies.cancel(
            db,
            delivery.clerkUserId,
            now,
          );
          canceled += result.canceled;
        }
      } catch {
        failed++;
      }
    }
    if (deliveries.length < 100) break;
    cursor = deliveries[deliveries.length - 1]!.id;
  }
  return { canceled, failed };
}

export async function runDailyJob(
  db: Database,
  now = new Date(),
  overrides: Partial<DailyJobDependencies> = {},
) {
  if (!Number.isFinite(now.getTime()))
    throw new Error("The batch date must be valid.");
  const batchDate = now.toISOString().slice(0, 10);
  const dependencies = { ...defaultDependencies, ...overrides };
  dependencies.cancel =
    overrides.cancel ??
    ((client, userId, at) =>
      cancelScheduledDailyReviews(
        client,
        userId,
        at,
        undefined,
        dependencies.send,
      ));
  const recovered = await recoverDailyCancellations(db, now, dependencies);
  let processed = 0,
    synced = 0,
    scheduled = 0,
    canceled = recovered.canceled,
    failed = recovered.failed,
    purgedEvents = 0;
  // The audit trail's retention purge runs with the daily backstop; a failed
  // purge is reported like any other failure and never holds up delivery.
  try {
    purgedEvents = await purgeBankProviderEvents(db, now);
  } catch (error) {
    console.error("Bank provider events could not be purged", error);
    failed++;
  }
  const emailReady = !!(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.APP_BASE_URL
  );
  let cursor: string | undefined;
  for (;;) {
    const members = await db.workspaceMember.findMany({
      where: { user: { active: true } },
      orderBy: { clerkUserId: "asc" },
      take: 100,
      ...(cursor ? { cursor: { clerkUserId: cursor }, skip: 1 } : {}),
    });
    processed += members.length;
    for (const member of members) {
      const userId = member.clerkUserId;
      try {
        const read = await dependencies.readBudget(db, userId);
        if (!read) continue;
        const { budget } = read;
        const connections = await db.bankConnection.findMany({
          where: { clerkUserId: userId },
          select: { lastSyncedAt: true },
        });
        if (
          connections.some(
            (connection) =>
              !connection.lastSyncedAt ||
              connection.lastSyncedAt.toISOString().slice(0, 10) < batchDate,
          )
        ) {
          try {
            await dependencies.syncBanks(db, userId);
            synced++;
          } catch {
            failed++;
          }
        }
        if (!emailReady || !budget.settings.emailEnabled) continue;
        const targets = dailyReviewSchedule(
          userId,
          {
            enabled: budget.settings.emailEnabled,
            timeZone: budget.settings.timezone,
            localTime: `${String(budget.settings.emailHour).padStart(2, "0")}:00`,
          },
          batchDate,
        );
        for (const target of targets) {
          const claim = await claimDailyDelivery(db, userId, target, now);
          if (!claim) continue;
          if (claim.kind === "expired") {
            failed++;
            continue;
          }
          const delivery = claim.delivery;
          let accepted = false;
          let attempted = false;
          try {
            const payload = delivery.payload
              ? savedPayload(delivery)
              : await preparePayload(db, userId, target, now, dependencies);
            await db.dailyDelivery.update({
              where: { id: delivery.id, leaseUntil: delivery.leaseUntil },
              data: {
                status: "sending",
                payload: jsonValue(payload),
                firstAttemptAt: delivery.firstAttemptAt ?? now,
              },
            });
            attempted = true;
            const result = await dependencies.send(payload);
            await db.dailyDelivery.update({
              where: { id: delivery.id, leaseUntil: delivery.leaseUntil },
              data: {
                status: "scheduled",
                providerId: result.id,
                sentAt: null,
                error: null,
              },
            });
            scheduled++;
            accepted = true;
          } catch (error) {
            await db.dailyDelivery.updateMany({
              where: {
                id: delivery.id,
                leaseUntil: delivery.leaseUntil,
                status: { in: ["preparing", "sending"] },
                providerId: null,
              },
              data: {
                status: "failed",
                error:
                  error instanceof Error
                    ? error.message
                    : "Daily email scheduling failed.",
              },
            });
            failed++;
          }
          if (attempted) {
            try {
              if (!(await dailyEmailEnabled(db, userId, dependencies))) {
                const result = await dependencies.cancel(db, userId, now);
                canceled += result.canceled;
                if (
                  accepted &&
                  result.canceled &&
                  delivery.scheduledAt &&
                  delivery.scheduledAt > now
                )
                  scheduled--;
              }
            } catch {
              failed++;
            }
          }
        }
      } catch {
        failed++;
      }
    }
    if (members.length < 100) break;
    cursor = members[members.length - 1]!.clerkUserId;
  }
  return {
    processed,
    synced,
    scheduled,
    canceled,
    failed,
    purgedEvents,
    emailConfigured: emailReady,
  };
}
