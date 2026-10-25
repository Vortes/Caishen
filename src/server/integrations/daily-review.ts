import { z } from "zod";

import {
  dateSchema,
  IntegrationError,
  providerIdSchema,
  readJsonResponse,
} from "./validation";

const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone");

export interface DailyReviewPreferences {
  enabled: boolean;
  timeZone: string;
  localTime?: string;
}

export interface DailyReviewSchedule {
  localDate: string;
  scheduledAt: string;
  dedupeKey: string;
}

export function dailyReviewSchedule(
  ownerId: string,
  preferences: DailyReviewPreferences,
  batchDateUTC: string,
): DailyReviewSchedule[] {
  providerIdSchema.parse(ownerId);
  const settings = z
    .object({
      enabled: z.boolean(),
      timeZone: timeZoneSchema,
      localTime: localTimeSchema.default("08:00"),
    })
    .parse(preferences);
  const batchDate = dateSchema.parse(batchDateUTC);
  if (!settings.enabled) return [];
  const day = 24 * 60 * 60_000;
  const start = new Date(`${batchDate}T00:00:00.000Z`).getTime();
  const end = start + day;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const localClock = (timestamp: number) => {
    const parts = formatter.formatToParts(timestamp);
    const get = (part: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === part)!.value;
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${get("hour")}:${get("minute")}`,
    };
  };
  const localDates = new Set([
    localClock(start).date,
    localClock(end - 60_000).date,
  ]);
  const schedules: DailyReviewSchedule[] = [];
  for (const localDate of localDates) {
    const wallTime = new Date(
      `${localDate}T${settings.localTime}:00.000Z`,
    ).getTime();
    // The offsets on either side of a clock change bound both repeated times
    // and the first valid minute after a skipped local time.
    const offsets = new Set(
      [-day, 0, day].map((distance) => {
        const timestamp = wallTime + distance;
        const clock = localClock(timestamp);
        return (
          new Date(`${clock.date}T${clock.time}:00.000Z`).getTime() - timestamp
        );
      }),
    );
    const candidates = [...offsets]
      .map((offset) => wallTime - offset)
      .sort((left, right) => left - right);
    let scheduled: number | undefined;
    for (
      let timestamp = candidates[0]!;
      timestamp <= candidates[candidates.length - 1]!;
      timestamp += 60_000
    ) {
      const clock = localClock(timestamp);
      if (clock.date === localDate && clock.time >= settings.localTime) {
        scheduled = timestamp;
        break;
      }
    }
    if (scheduled === undefined || scheduled < start || scheduled >= end)
      continue;
    schedules.push({
      localDate,
      scheduledAt: new Date(scheduled).toISOString(),
      dedupeKey: `daily-review:${ownerId}:${localDate}`,
    });
  }
  return schedules.sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt),
  );
}

export interface DailyReviewMessageInput {
  appBaseUrl: string;
  inboxCount: number;
  latestSuccessfulSync: Date | null;
  timeZone: string;
  unsubscribeUrl?: string;
}

export function buildDailyReviewMessage(input: DailyReviewMessageInput): {
  subject: string;
  text: string;
} {
  const appUrl = z.string().url().parse(input.appBaseUrl);
  const url = new URL(appUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Daily review links require an HTTPS app URL without credentials or query parameters.",
    );
  const count = z.number().int().min(0).max(1_000_000).parse(input.inboxCount);
  const zone = timeZoneSchema.parse(input.timeZone);
  if (
    input.latestSuccessfulSync &&
    !Number.isFinite(input.latestSuccessfulSync.getTime())
  )
    throw new Error("The account update time must be valid.");
  const freshness = input.latestSuccessfulSync
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(input.latestSuccessfulSync)
    : "No successful bank update yet";
  return {
    subject: count
      ? `${count} ${count === 1 ? "item" : "items"} to review in Caishen`
      : "Your Caishen review inbox is clear",
    text: `${count} unresolved ${count === 1 ? "item is" : "items are"} in your private review inbox.\n\nLatest successful account update: ${freshness}. Bank data may arrive later than the transaction.\n\nOpen your inbox: ${new URL("/app/accounts?view=review", url.origin).toString()}\n\nYour inbox keeps unresolved items together, including after missed days.${input.unsubscribeUrl ? `\n\nTurn off daily emails: ${input.unsubscribeUrl}` : ""}`,
  };
}

export function createResendClient(
  config: { apiKey: string; from: string },
  fetcher: typeof fetch = fetch,
) {
  if (!config.apiKey || !config.from)
    throw new IntegrationError(
      "Email",
      "NOT_CONFIGURED",
      "A Resend API key and verified sender address are required.",
    );
  const from = z
    .string()
    .min(3)
    .max(320)
    .refine((value) => !/[\r\n]/.test(value))
    .parse(config.from);
  return {
    async cancelEmail(emailId: string): Promise<{ id: string }> {
      const id = providerIdSchema.regex(/^[A-Za-z0-9_-]+$/).parse(emailId);
      const emailUrl = `https://api.resend.com/emails/${encodeURIComponent(id)}`;
      const headers = {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      };
      const response = await fetcher(`${emailUrl}/cancel`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) {
        // A lost cancellation acknowledgement can be recovered from its terminal event.
        const confirmation = await fetcher(emailUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        }).catch(() => null);
        if (confirmation?.ok) {
          const canceled = z
            .object({ id: z.literal(id), last_event: z.literal("canceled") })
            .safeParse(
              await readJsonResponse(confirmation, "Email", 20_000).catch(
                () => null,
              ),
            );
          if (canceled.success) return { id };
        }
        throw new IntegrationError(
          "Email",
          "REQUEST_FAILED",
          response
            ? `Queued email cancellation failed (HTTP ${response.status}).`
            : "Queued email cancellation could not be confirmed. Retry the request.",
        );
      }
      return z
        .object({ id: z.literal(id) })
        .parse(await readJsonResponse(response, "Email", 20_000));
    },
    async sendDailyReview(input: {
      to: string;
      dedupeKey: string;
      message: { subject: string; text: string };
      scheduledAt?: string;
      unsubscribeUrl?: string;
    }): Promise<{ id: string }> {
      const recipient = z.string().email().max(320).parse(input.to);
      const dedupeKey = z
        .string()
        .min(1)
        .max(256)
        .regex(/^[\x21-\x7e]+$/)
        .parse(input.dedupeKey);
      const message = z
        .object({
          subject: z
            .string()
            .min(1)
            .max(200)
            .refine((value) => !/[\r\n]/.test(value)),
          text: z.string().min(1).max(10_000),
        })
        .strict()
        .parse(input.message);
      const scheduledAt = z
        .string()
        .datetime({ offset: true })
        .refine((value) => Number.isFinite(new Date(value).getTime()))
        .optional()
        .parse(input.scheduledAt);
      const unsubscribeUrl = input.unsubscribeUrl
        ? z
            .string()
            .url()
            .regex(/^https:\/\//)
            .max(2048)
            .parse(input.unsubscribeUrl)
        : undefined;
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": dedupeKey,
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: message.subject,
          text: message.text,
          ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
          ...(unsubscribeUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (!response.ok)
        throw new IntegrationError(
          "Email",
          "REQUEST_FAILED",
          `Email delivery failed (HTTP ${response.status}).`,
        );
      return z
        .object({ id: z.string().min(1).max(256) })
        .parse(await readJsonResponse(response, "Email", 20_000));
    },
  };
}
