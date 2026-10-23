import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Database } from "./household";
import { requireHousehold } from "./household";
import { commandHash } from "./safety";

const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export async function limitInviteChecks(db: Database, userId: string) {
  const now = new Date();
  const count = await db.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: {
        clerkUserId: userId,
        OR: [
          { inviteWindow: null },
          { inviteWindow: { lte: new Date(now.getTime() - 600_000) } },
        ],
      },
      data: { inviteChecks: 0, inviteWindow: now },
    });
    const user = await tx.user.update({
      where: { clerkUserId: userId },
      data: { inviteChecks: { increment: 1 } },
    });
    return user.inviteChecks;
  });
  if (count > 10)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many tries. Codes can be checked again in 10 minutes.",
    });
}

export function normalizeInvite(code: string) {
  return code.length >= 20 ? code : code.replace(/[\s-]/g, "").toUpperCase();
}

export async function createPartnerInvite(db: Database, userId: string) {
  const { household } = await requireHousehold(db, userId);
  if (
    [...(household.rows.get("member")?.values() ?? [])].filter(
      (row) => !row.deleted,
    ).length >= 2
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Your partner is already connected.",
    });
  const raw = Array.from(
    { length: 8 },
    () => alphabet[randomInt(alphabet.length)],
  ).join("");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.$transaction(async (tx) => {
    await tx.partnerInvite.deleteMany({
      where: { createdBy: userId, usedBy: null },
    });
    await tx.partnerInvite.create({
      data: {
        tokenHash: commandHash(raw),
        workspaceId: household.workspaceId,
        createdBy: userId,
        expiresAt,
      },
    });
  });
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
}

export async function readPartnerInvite(
  db: Database,
  userId: string,
  code: string,
) {
  const invite = await db.partnerInvite.findUnique({
    where: { tokenHash: commandHash(normalizeInvite(code)) },
  });
  if (!invite)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "No invite matches this code. Check each character with your partner.",
    });
  if (invite.usedBy)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This code was already used. Ask your partner for a new one.",
    });
  if (invite.expiresAt <= new Date())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This code expired. Codes last 24 hours; ask your partner for a new one.",
    });
  if (invite.createdBy === userId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "That’s your own code. Give it to your partner to enter in their own account.",
    });
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: invite.workspaceId },
  });
  if (members.length >= 2)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "That budget already has a partner connected, and a budget has room for one.",
    });
  if (!members.some((member) => member.clerkUserId === invite.createdBy))
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "This code doesn’t work anymore. Ask your partner for a new one.",
    });
  return invite;
}

export async function checkPartnerInvite(
  db: Database,
  userId: string,
  code: string,
) {
  await limitInviteChecks(db, userId);
  const invite = await readPartnerInvite(db, userId, code);
  const { ledger } = await requireHousehold(db, invite.createdBy);
  return { name: ledger.budget.name };
}
