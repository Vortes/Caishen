import { createHmac, randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createResendClient } from "~/server/integrations/daily-review";
import type { Household } from "~/server/storage/households";
import { firstName, WASHI, washiById, type WashiId } from "~/domain/invitation";
import type { Database } from "./household";
import { requireHousehold } from "./household";
import { commandHash } from "./safety";

function refuseIfPartnered(household: Household) {
  if (
    [...(household.rows.get("member")?.values() ?? [])].filter(
      (row) => !row.deleted,
    ).length >= 2
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Your partner is already connected.",
    });
}

// Invitations by email (ADR 0011).

const INVITATION_DAYS = 7;
// How many invitation emails, sends and resends together, one person can
// send in a day.
const EMAILS_PER_DAY = 10;

export const washiSchema = z.enum(
  WASHI.map((washi) => washi.id) as [WashiId, ...WashiId[]],
);
// The sender's signature, as the composer's pen lays it. Capped, since it's
// stored and sent to the partner whole.
export const signatureSchema = z
  .array(
    z.object({
      points: z
        .array(
          z.object({
            x: z.number().finite(),
            y: z.number().finite(),
            t: z.number().finite().nonnegative(),
          }),
        )
        .min(1)
        .max(4000),
    }),
  )
  .min(1)
  .max(200)
  .refine(
    (strokes) =>
      strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) <= 4000,
    "The signature is too long.",
  );

/** What sending an invitation needs from outside Caishen. */
export type InvitationOutbox = {
  /** The sender as their identity provider knows them now. */
  sender: (
    userId: string,
  ) => Promise<{ name: string | null; emails: string[] }>;
  /** Reaches Resend. */
  fetch: typeof fetch;
};

const outbox: InvitationOutbox = {
  async sender(userId) {
    const user = await (await clerkClient()).users.getUser(userId);
    return {
      name: user.fullName ?? user.firstName,
      emails: user.emailAddresses.map((address) => address.emailAddress),
    };
  },
  fetch: (input, init) => fetch(input, init),
};

// The link's token is derived from the invitation, so Resend can send the
// same link again while only its hash is stored.
export function invitationToken(id: string) {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("Invitations require the application signing key.");
  return createHmac("sha256", key)
    .update(`caishen-partner-invitation:v1:${id}`)
    .digest("base64url");
}

function appUrl() {
  const base = process.env.APP_BASE_URL;
  if (!base || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invitation email isn’t set up yet.",
    });
  return new URL(base).origin;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

function invitationEmail(input: {
  senderName: string;
  email: string;
  washi: WashiId;
  link: string;
  origin: string;
}) {
  const name = escape(input.senderName);
  const image = `${input.origin}/invite/washi/${input.washi}.png`;
  const subject = `${input.senderName} invited you to share a budget on Caishen`;
  const entered = `${input.senderName} entered ${input.email} to invite you. If you weren’t expecting this, you can ignore this email.`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td><img src="${image}" width="416" alt="A card folded from ${escape(washiById(input.washi).name)} washi" style="display:block;width:100%;height:auto;border-radius:8px"></td></tr>
<tr><td style="padding-top:24px;font-size:20px;line-height:28px;font-weight:600">${name} wrote you an invitation</td></tr>
<tr><td style="padding-top:8px;font-size:15px;line-height:22px;color:#555555">Open it to share a budget with ${name} on Caishen.</td></tr>
<tr><td style="padding-top:24px"><a href="${input.link}" style="display:inline-block;background:#1f1f1f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px">Open the invitation</a></td></tr>
<tr><td style="padding-top:32px;font-size:13px;line-height:19px;color:#777777">${escape(entered)}</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = `${input.senderName} wrote you an invitation to share a budget on Caishen.\n\nOpen the invitation: ${input.link}\n\n${entered}`;
  return { subject, html, text };
}

async function limitInvitationEmails(db: Database, userId: string) {
  const now = new Date();
  const count = await db.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: {
        clerkUserId: userId,
        OR: [
          { inviteSendWindow: null },
          { inviteSendWindow: { lte: new Date(now.getTime() - 86_400_000) } },
        ],
      },
      data: { inviteSends: 0, inviteSendWindow: now },
    });
    const user = await tx.user.update({
      where: { clerkUserId: userId },
      data: { inviteSends: { increment: 1 } },
    });
    return user.inviteSends;
  });
  if (count > EMAILS_PER_DAY)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You’ve sent a lot of invitations today. Try again tomorrow.",
    });
}

// Emails the invitation, keyed so a retried request doesn't send it twice,
// and counts the email once Resend has it.
async function emailInvitation(
  db: Database,
  invitation: {
    id: string;
    email: string;
    senderName: string;
    washi: WashiId;
    emails: number;
  },
  fetcher: typeof fetch,
) {
  const origin = appUrl();
  const link = `${origin}/invite/${invitationToken(invitation.id)}`;
  try {
    await createResendClient(
      {
        apiKey: process.env.RESEND_API_KEY!,
        from: process.env.EMAIL_FROM!,
      },
      fetcher,
    ).sendInvitation({
      to: invitation.email,
      idempotencyKey: `partner-invitation:${invitation.id}:${invitation.emails}`,
      ...invitationEmail({ ...invitation, link, origin }),
    });
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The invitation email didn’t send. Try again.",
    });
  }
  await db.partnerInvite.updateMany({
    where: { id: invitation.id, emails: invitation.emails },
    data: { emails: { increment: 1 } },
  });
}

const live = (userId: string) => ({
  createdBy: userId,
  email: { not: null },
  usedBy: null,
  cancelledAt: null,
});

/**
 * Sends a new invitation to `email`, replacing the sender's live one. It's
 * saved only once the email has gone, so a failed send leaves the earlier
 * invitation as it was.
 */
export async function sendPartnerInvitation(
  db: Database,
  userId: string,
  input: {
    email: string;
    washi: WashiId;
    signature: { points: { x: number; y: number; t: number }[] }[];
  },
  dependencies: Partial<InvitationOutbox> = {},
) {
  const { sender, fetch: fetcher } = { ...outbox, ...dependencies };
  const email = input.email.trim();
  if (!z.string().email().max(320).safeParse(email).success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Enter your partner’s full email address, like name@example.com.",
    });
  const { household } = await requireHousehold(db, userId);
  refuseIfPartnered(household);
  const profile = await sender(userId);
  if (
    profile.emails.some(
      (address) => address.toLowerCase() === email.toLowerCase(),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That’s your own email. Enter your partner’s.",
    });
  const senderName = profile.name?.trim();
  if (!senderName)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Add your name to your account so your partner knows who it’s from.",
    });
  await limitInvitationEmails(db, userId);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  // Nothing is saved yet, so the email's count is settled when it is.
  await emailInvitation(
    db,
    { id, email, senderName, washi: input.washi, emails: 0 },
    fetcher,
  );
  await db.$transaction(async (tx) => {
    // Holds the sender's row so two sends at once still leave one live.
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "clerkUserId" = ${userId} FOR UPDATE`;
    await tx.partnerInvite.updateMany({
      where: live(userId),
      data: { cancelledAt: new Date(), replaced: true },
    });
    await tx.partnerInvite.create({
      data: {
        id,
        tokenHash: commandHash(invitationToken(id)),
        workspaceId: household.workspaceId,
        createdBy: userId,
        expiresAt,
        email,
        senderName,
        washi: input.washi,
        signature: input.signature.map((stroke) => ({ points: stroke.points })),
        emails: 1,
      },
    });
  });
  return { email, expiresAt };
}

/** The sender's live invitation, expired or not, or null. */
export async function readSentInvitation(db: Database, userId: string) {
  const invitation = await db.partnerInvite.findFirst({
    where: live(userId),
    orderBy: { createdAt: "desc" },
  });
  if (!invitation) return null;
  return {
    email: invitation.email!,
    expiresAt: invitation.expiresAt,
    expired: invitation.expiresAt <= new Date(),
  };
}

/** Sends the live invitation's link again, in a new email. */
export async function resendPartnerInvitation(
  db: Database,
  userId: string,
  dependencies: Partial<InvitationOutbox> = {},
) {
  const { fetch: fetcher } = { ...outbox, ...dependencies };
  const invitation = await db.partnerInvite.findFirst({
    where: { ...live(userId), expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!invitation)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invitation can’t be sent again. Write a new one.",
    });
  await limitInvitationEmails(db, userId);
  await emailInvitation(
    db,
    {
      id: invitation.id,
      email: invitation.email!,
      senderName: invitation.senderName!,
      washi: washiSchema.parse(invitation.washi),
      emails: invitation.emails,
    },
    fetcher,
  );
  return { email: invitation.email!, expiresAt: invitation.expiresAt };
}

/** Kills the sender's live invitation: its link stops working at once. */
export async function cancelPartnerInvitation(db: Database, userId: string) {
  await db.partnerInvite.updateMany({
    where: live(userId),
    data: { cancelledAt: new Date() },
  });
}

type StoredInvitation = NonNullable<
  Awaited<ReturnType<Database["partnerInvite"]["findUnique"]>>
>;

// Where an invitation by email stands. Used, cancelled, and replaced are
// final; expired is only told once nothing else ended it.
function standing(invitation: StoredInvitation) {
  if (invitation.usedBy) return "used";
  if (invitation.replaced) return "replaced";
  if (invitation.cancelledAt) return "cancelled";
  if (invitation.expiresAt <= new Date()) return "expired";
  return "live";
}

/**
 * What an invitation's link opens: the card, or why it no longer works.
 * Anyone holding the link may read it; the person who accepted it is sent
 * on to their budget, and someone signed in who can't accept it is told why.
 */
export async function openPartnerInvitation(
  db: Database,
  userId: string | null,
  token: string,
) {
  const invitation = await db.partnerInvite.findUnique({
    where: { tokenHash: commandHash(token) },
  });
  if (!invitation?.email) return { status: "invalid", from: null } as const;
  const status = standing(invitation);
  if (status === "used" && userId && invitation.usedBy === userId)
    return { status: "joined" } as const;
  if (status !== "live")
    return { status, from: invitation.senderName } as const;
  // Someone signed in hears why they can't accept before the card flies.
  if (userId) {
    const room = await roomFor(db, userId, invitation);
    if (room !== "room")
      return { status: room, from: invitation.senderName } as const;
  }
  return {
    status,
    id: invitation.id,
    from: invitation.senderName!,
    email: invitation.email,
    washi: washiSchema.parse(invitation.washi),
    signature: signatureSchema.parse(invitation.signature),
  } as const;
}

// Whether both sides still have room: `userId` has no partner, and the
// sender is still in their budget, alone.
async function roomFor(
  db: Database,
  userId: string,
  invitation: Pick<StoredInvitation, "workspaceId" | "createdBy">,
) {
  const own = await db.workspaceMember.findUnique({
    where: { clerkUserId: userId },
  });
  if (
    own &&
    (await db.workspaceMember.count({
      where: { workspaceId: own.workspaceId },
    })) >= 2
  )
    return "partnered";
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: invitation.workspaceId },
  });
  if (!members.some((member) => member.clerkUserId === invitation.createdBy))
    return "left";
  if (members.length >= 2) return "full";
  return "room";
}

const refuse = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });

/**
 * The invitation `userId` accepts by signing it, once it's still live and
 * both sides have room: the recipient has no partner, and the sender is
 * still in their budget, alone.
 */
export async function readInvitationToJoin(
  db: Database,
  userId: string,
  id: string,
) {
  const invitation = await db.partnerInvite.findUnique({ where: { id } });
  if (!invitation?.email)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "This invitation doesn’t exist. Open the link in its email again.",
    });
  const sender = firstName(invitation.senderName!);
  const status = standing(invitation);
  if (status === "used") throw refuse("This invitation was already accepted.");
  if (status === "replaced")
    throw refuse(
      `${sender} sent a newer invitation. Open the link in the latest email.`,
    );
  if (status === "cancelled")
    throw refuse(`${sender} cancelled this invitation.`);
  if (status === "expired")
    throw refuse(
      `This invitation expired. Invitations last seven days; ask ${sender} for a new one.`,
    );
  if (invitation.createdBy === userId)
    throw refuse(
      "That’s your own invitation. Your partner accepts it from their email.",
    );
  const room = await roomFor(db, userId, invitation);
  if (room === "partnered")
    throw refuse(
      "You already share a budget with a partner, and a budget has room for one.",
    );
  if (room === "left")
    throw refuse(
      `${sender} isn’t using that budget anymore, so this invitation can’t be accepted.`,
    );
  if (room === "full")
    throw refuse(`${sender} already shares a budget with someone else.`);
  return invitation;
}

/**
 * Deletes invitations that are used, cancelled, replaced, or past expiry,
 * which removes the invited address and the signature with them. Run by the
 * daily job; live invitations are untouched.
 */
export async function sweepSpentInvitations(db: Database, now: Date) {
  const { count } = await db.partnerInvite.deleteMany({
    where: {
      OR: [
        { usedBy: { not: null } },
        { cancelledAt: { not: null } },
        { replaced: true },
        { expiresAt: { lte: now } },
      ],
    },
  });
  return count;
}
