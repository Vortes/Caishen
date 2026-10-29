import { clerkClient } from "@clerk/nextjs/server";
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import {
  buildDailyReviewMessage,
  createResendClient,
  dailyReviewSchedule,
} from "~/server/integrations/daily-review";
import { bankInbox, syncBanks } from "./banks";
import type { BankUpdateOutcome } from "./banks/imports";
import { purgeBankProviderEvents } from "./bank-provider-events";
import {
  cancelScheduledDailyReviews,
  claimDailyDelivery,
  dailyDeliveryPayloadSchema,
  type DailyDeliveryPayload,
  type DailyDeliveryTarget,
} from "./daily-delivery";
import { domainRefusal, jsonValue } from "./safety";
import type { Budget } from "~/domain/engine";
import { openHousehold, type Database } from "./household";
import { budgetMaintenance, reportUnreadable, zodIssues } from "./stored-data";
import { emailPreferenceToken } from "./email-preferences";
import { sweepSpentInvitations } from "./partner-invites";

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

/**
 * The connections a run updates, in a fixed order: every one not revoked or
 * disconnected that has not synced since the run's UTC day began, or that a
 * webhook asked to update since it last synced.
 */
async function dueConnections(db: Database, now: Date) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const connections = await db.bankConnection.findMany({
    where: {
      status: { notIn: ["revoked", "disconnected"] },
      user: { active: true },
    },
    select: {
      id: true,
      clerkUserId: true,
      lastSyncedAt: true,
      updateRequestedAt: true,
    },
    orderBy: { id: "asc" },
  });
  return connections.filter(
    ({ lastSyncedAt, updateRequestedAt }) =>
      !lastSyncedAt ||
      lastSyncedAt < today ||
      (updateRequestedAt && updateRequestedAt > lastSyncedAt),
  );
}

/** Each due connection's update, grouped by owner; one never stops another. */
async function reconcileBanks(
  db: Database,
  due: Awaited<ReturnType<typeof dueConnections>>,
  dependencies: DailyJobDependencies,
) {
  const owners = new Map<string, string[]>();
  for (const connection of due)
    owners.set(connection.clerkUserId, [
      ...(owners.get(connection.clerkUserId) ?? []),
      connection.id,
    ]);
  const outcomes: BankUpdateOutcome[] = [];
  for (const [userId, connectionIds] of owners) {
    try {
      outcomes.push(
        ...(await dependencies.syncBanks(db, userId, { connectionIds }))
          .outcomes,
      );
    } catch (error) {
      const refused = domainRefusal(error);
      outcomes.push(
        ...connectionIds.map((connectionId) => ({
          connectionId,
          kind: "failed" as const,
          error: refused,
        })),
      );
    }
  }
  return outcomes;
}

/** How long a connection may go without a committed update before alerting. */
const STALE_AFTER_MS = 28 * 60 * 60 * 1000;

/**
 * Connections whose update failed and that have now gone 28 hours without a
 * committed one. Midnight and 06:00 runs put a connection that last synced at
 * yesterday's midnight run at 24 and 30 hours, so one failed run is tolerated
 * and a second is not. Connections waiting on the member to sign in again are
 * left to the Banks panel.
 */
async function staleConnections(
  db: Database,
  outcomes: BankUpdateOutcome[],
  now: Date,
) {
  const failed = outcomes
    .filter((outcome) => outcome.kind === "failed")
    .map((outcome) => outcome.connectionId);
  if (!failed.length) return [];
  const connections = await db.bankConnection.findMany({
    where: {
      id: { in: failed },
      status: { notIn: ["login_required", "revoked", "disconnected"] },
    },
    select: { id: true, createdAt: true, lastSyncedAt: true },
    orderBy: { id: "asc" },
  });
  return connections
    .filter(
      ({ createdAt, lastSyncedAt }) =>
        now.getTime() - (lastSyncedAt ?? createdAt).getTime() > STALE_AFTER_MS,
    )
    .map((connection) => connection.id);
}

/**
 * One daily run: bank updates first, then each member's daily review, then
 * maintenance. Each phase's failures are counted and never stop the next, so
 * running again is the retry. Throws only when the run cannot start.
 */
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
  const started = Date.now();
  const due = await dueConnections(db, now);
  const outcomes = await reconcileBanks(db, due, dependencies);
  console.info("Daily bank updates finished", {
    eligible: due.length,
    outcomes: outcomes.map((outcome) => ({
      connectionId: outcome.connectionId,
      outcome: outcome.kind,
      // Refusals name a Plaid request id, never tokens or provider bodies.
      ...("error" in outcome ? { error: outcome.error.message } : {}),
    })),
    durationMs: Date.now() - started,
  });
  let processed = 0,
    synced = 0,
    scheduled = 0,
    canceled = 0,
    failed = 0,
    purgedEvents = 0,
    sweptInvitations = 0;
  for (const outcome of outcomes)
    if (outcome.kind === "synced") synced++;
    else if (outcome.kind === "failed") failed++;
  const emailReady = !!(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.APP_BASE_URL
  );
  try {
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
  } catch (error) {
    console.error("Daily reviews could not be scheduled", error);
    failed++;
  }
  try {
    const recovered = await recoverDailyCancellations(db, now, dependencies);
    canceled += recovered.canceled;
    failed += recovered.failed;
  } catch (error) {
    console.error("Daily review cancellations could not be recovered", error);
    failed++;
  }
  // The audit trail's retention purge runs with the daily backstop; a failed
  // purge is reported like any other failure and never holds up delivery.
  try {
    purgedEvents = await purgeBankProviderEvents(db, now);
  } catch (error) {
    console.error("Bank provider events could not be purged", error);
    failed++;
  }
  // Spent invitations go with the same backstop, on the same terms.
  try {
    sweptInvitations = await sweepSpentInvitations(db, now);
  } catch (error) {
    console.error("Spent invitations could not be swept", error);
    failed++;
  }
  const result = {
    processed,
    synced,
    scheduled,
    canceled,
    failed,
    purgedEvents,
    sweptInvitations,
    emailConfigured: emailReady,
    stale: await staleConnections(db, outcomes, now),
  };
  console.info("Daily job finished", {
    ...result,
    durationMs: Date.now() - started,
  });
  return result;
}
