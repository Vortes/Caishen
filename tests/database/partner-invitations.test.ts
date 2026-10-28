import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const keys = [
  "CLERK_SECRET_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
process.env.CLERK_SECRET_KEY = "fixture-signing-key";
process.env.RESEND_API_KEY = "fixture-never-call-provider";
process.env.EMAIL_FROM = "Caishen <invites@caishen.example>";
process.env.APP_BASE_URL = "https://caishen.example";
const users: string[] = [];
const workspaces = new Set<string>();

after(async () => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  await db.workspace.deleteMany({ where: { id: { in: [...workspaces] } } });
  await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
  await db.$disconnect();
});

type Sent = {
  idempotencyKey: string | null;
  to: string[];
  subject: string;
  html: string;
  text: string;
  link: string;
};

// A person with a budget, whose identity provider knows them by `name` and
// these addresses, and whose email goes to a fake Resend.
async function member(name: string, emails: string[]) {
  const id = `test-invitation-${randomUUID()}`;
  users.push(id);
  const sent: Sent[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    const body = JSON.parse(init!.body as string) as Omit<Sent, "link">;
    const link = /https:\/\/caishen\.example\/invite\/[A-Za-z0-9_-]+/.exec(
      body.text,
    )?.[0];
    assert.ok(link, "the email links to the invitation");
    sent.push({
      idempotencyKey: new Headers(init!.headers).get("Idempotency-Key"),
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      link,
    });
    return Response.json({ id: `email_${sent.length}` });
  };
  const api = createCaller({
    db,
    userId: id,
    headers: new Headers({ [CLIENT_FORMAT_HEADER]: String(CLIENT_FORMAT) }),
    revision: new ObservedRevision(),
    outbox: { fetch: fetcher, sender: async () => ({ name, emails }) },
  });
  await api.budget.onboard({
    name: `${name}’s budget`,
    month: "2026-10",
    timezone: "America/Los_Angeles",
  });
  const membership = await db.workspaceMember.findUniqueOrThrow({
    where: { clerkUserId: id },
  });
  workspaces.add(membership.workspaceId);
  return { id, api, sent };
}

const signature = [
  {
    points: [
      { x: 1, y: 2, t: 0 },
      { x: 3, y: 4, t: 16 },
    ],
    dried: 0,
  },
];

void test("an invitation is emailed, resent with the same link, replaced by a newer one, and cancelled", async () => {
  const sender = await member("Jordan Lee", [
    "jordan@example.com",
    "Jordan.Work@example.com",
  ]);
  assert.equal(await sender.api.budget.invitation(), null);

  for (const email of ["not-an-address", "jordan.work@EXAMPLE.com"])
    await assert.rejects(
      () =>
        sender.api.budget.sendInvitation({
          email,
          washi: "vermilion",
          signature,
        }),
      { code: "BAD_REQUEST" },
    );
  await assert.rejects(
    () =>
      sender.api.budget.sendInvitation({
        email: "alex@example.com",
        washi: "vermilion",
        signature: Array.from({ length: 6000 }, () => signature[0]!),
      }),
    { code: "BAD_REQUEST" },
  );
  assert.equal(sender.sent.length, 0);

  const first = await sender.api.budget.sendInvitation({
    email: " Alex@Example.com ",
    washi: "vermilion",
    signature,
  });
  assert.equal(first.email, "Alex@Example.com");
  const days = (first.expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.99 && days <= 7, "it lasts seven days");
  const [email] = sender.sent;
  assert.deepEqual(email!.to, ["Alex@Example.com"]);
  assert.match(email!.subject, /Jordan Lee/);
  assert.match(email!.html, /Jordan Lee/);
  assert.ok(email!.html.includes(email!.link), "one button to the link");
  assert.ok(
    email!.html.includes("https://caishen.example/invite/washi/vermilion.png"),
    "a static picture of the chosen washi",
  );
  assert.match(email!.text, /Jordan Lee entered Alex@Example\.com/);
  assert.ok(email!.idempotencyKey);
  assert.deepEqual(await sender.api.budget.invitation(), {
    email: "Alex@Example.com",
    expiresAt: first.expiresAt,
    expired: false,
  });

  await sender.api.budget.resendInvitation();
  const resent = sender.sent[1]!;
  assert.equal(resent.link, email!.link, "Resend sends the same link");
  assert.notEqual(resent.idempotencyKey, email!.idempotencyKey);

  const second = await sender.api.budget.sendInvitation({
    email: "sam@example.com",
    washi: "indigo",
    signature,
  });
  const replacement = sender.sent[2]!;
  assert.deepEqual(replacement.to, ["sam@example.com"]);
  assert.notEqual(replacement.link, email!.link);
  assert.deepEqual(await sender.api.budget.invitation(), {
    email: "sam@example.com",
    expiresAt: second.expiresAt,
    expired: false,
  });

  await db.partnerInvite.updateMany({
    where: { createdBy: sender.id, email: "sam@example.com" },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await sender.api.budget.invitation())?.expired, true);
  await assert.rejects(() => sender.api.budget.resendInvitation(), {
    code: "NOT_FOUND",
  });

  await sender.api.budget.cancelInvitation();
  assert.equal(await sender.api.budget.invitation(), null);
  await assert.rejects(() => sender.api.budget.resendInvitation(), {
    code: "NOT_FOUND",
  });
  assert.equal(sender.sent.length, 3);

  // Once a partner joins, there's no one left to invite.
  const partner = await member("Alex Kim", ["alex@example.com"]);
  const code = await sender.api.budget.invite();
  await partner.api.budget.join({ code: code.code });
  await assert.rejects(
    () =>
      sender.api.budget.sendInvitation({
        email: "someone@example.com",
        washi: "indigo",
        signature,
      }),
    { code: "BAD_REQUEST", message: /already connected/ },
  );
  assert.equal(sender.sent.length, 3);
});

void test("one person can send only so many invitation emails a day", async () => {
  const sender = await member("Jordan Lee", ["jordan@example.com"]);
  await sender.api.budget.sendInvitation({
    email: "alex@example.com",
    washi: "matcha",
    signature,
  });
  for (let resend = 1; resend < 10; resend++)
    await sender.api.budget.resendInvitation();
  await assert.rejects(() => sender.api.budget.resendInvitation(), {
    code: "TOO_MANY_REQUESTS",
  });
  await assert.rejects(
    () =>
      sender.api.budget.sendInvitation({
        email: "sam@example.com",
        washi: "matcha",
        signature,
      }),
    { code: "TOO_MANY_REQUESTS" },
  );
  assert.equal(sender.sent.length, 10);
  assert.equal(
    (await sender.api.budget.invitation())?.email,
    "alex@example.com",
  );
});
