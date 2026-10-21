import { z } from "zod";

import {
  addCents,
  centsSchema,
  dateSchema,
  providerIdSchema,
} from "./validation";

const activitySchema = z
  .object({
    date: dateSchema,
    description: z.string().min(1).max(500),
    /** Signed change in the account balance, with deposits positive. */
    amountCents: centsSchema,
    reference: z.string().min(1).max(256).optional(),
    pending: z.boolean().optional(),
  })
  .strict();

export type StatementActivity = z.infer<typeof activitySchema>;

const snapshotSchema = z
  .object({
    accountId: providerIdSchema,
    currency: z.literal("USD"),
    periodStart: dateSchema,
    cutoff: dateSchema,
    openingBalanceCents: centsSchema,
    closingBalanceCents: centsSchema,
    activity: z.array(activitySchema).max(5000),
    balanceKind: z.literal("cleared"),
  })
  .strict();

export type ClearedSnapshot = z.infer<typeof snapshotSchema>;
export type StatementEvidence = ClearedSnapshot & {
  source: "statement" | "institution" | "cached_balance";
  verified: boolean;
  activityComplete: boolean;
};

export interface ReconciliationResult {
  status: "reconciled" | "discrepancy" | "insufficient_evidence";
  differenceCents: number | null;
  reasons: string[];
  missingFromLedger: StatementActivity[];
  missingFromStatement: StatementActivity[];
}

export const reconciliationResultSchema = z
  .object({
    status: z.enum(["reconciled", "discrepancy", "insufficient_evidence"]),
    differenceCents: centsSchema.nullable(),
    reasons: z.array(z.string().max(1000)).max(100),
    missingFromLedger: z.array(activitySchema).max(5000),
    missingFromStatement: z.array(activitySchema).max(5000),
  })
  .strict();

// What reading saved evidence needs: the revision it was compared against.
export const savedEvidenceSchema = z.object({
  revision: z.number().int().nonnegative(),
});

export function savedReconciliationResult(
  result: unknown,
  evidence: unknown,
  currentRevision: number,
  alert?: (error: z.ZodError) => void,
): ReconciliationResult {
  const revision = z.number().int().nonnegative().parse(currentRevision);
  const saved = savedEvidenceSchema.safeParse(evidence);
  if (!saved.success || saved.data.revision !== revision) {
    return {
      status: "insufficient_evidence",
      differenceCents: null,
      reasons: [
        "The ledger changed after this statement comparison, or its revision is unknown. Reconcile again to verify the current records.",
      ],
      missingFromLedger: [],
      missingFromStatement: [],
    };
  }
  const parsed = reconciliationResultSchema.safeParse(result);
  if (!parsed.success) alert?.(parsed.error);
  return parsed.success
    ? parsed.data
    : {
        status: "insufficient_evidence",
        differenceCents: null,
        reasons: [
          "The saved statement comparison could not be verified. Reconcile again.",
        ],
        missingFromLedger: [],
        missingFromStatement: [],
      };
}

function activityKey(activity: StatementActivity): string {
  return JSON.stringify([
    activity.date,
    activity.amountCents,
    activity.description
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/\s+/g, " ")
      .trim(),
  ]);
}

export function reconcileStatement(
  ledgerInput: ClearedSnapshot,
  evidenceInput: StatementEvidence,
): ReconciliationResult {
  const ledger = snapshotSchema.parse(ledgerInput);
  const evidence = snapshotSchema
    .extend({
      source: z.enum(["statement", "institution", "cached_balance"]),
      verified: z.boolean(),
      activityComplete: z.boolean(),
    })
    .parse(evidenceInput);
  const reasons: string[] = [];
  const insufficient = (reason: string): ReconciliationResult => ({
    status: "insufficient_evidence",
    differenceCents: null,
    reasons: [reason],
    missingFromLedger: [],
    missingFromStatement: [],
  });
  if (
    !evidence.verified ||
    !evidence.activityComplete ||
    evidence.source === "cached_balance"
  )
    return insufficient(
      "A verified statement or institution record with complete cleared activity is required. Cached balances cannot establish reconciliation.",
    );
  if (
    ledger.accountId !== evidence.accountId ||
    ledger.currency !== evidence.currency
  )
    return insufficient(
      "Statement account and currency must match the ledger.",
    );
  if (
    ledger.periodStart !== evidence.periodStart ||
    ledger.cutoff !== evidence.cutoff
  )
    return insufficient(
      "Compare cleared balances and activity for exactly the same period and cutoff.",
    );
  if (ledger.periodStart > ledger.cutoff)
    return insufficient("The statement period cannot end before it starts.");
  for (const snapshot of [ledger, evidence]) {
    if (snapshot.activity.some((activity) => activity.pending))
      return insufficient(
        "Pending activity cannot be mixed into a cleared statement comparison.",
      );
    if (
      snapshot.activity.some(
        (activity) =>
          activity.date < snapshot.periodStart ||
          activity.date > snapshot.cutoff,
      )
    )
      return insufficient(
        "All compared activity must fall within the stated period.",
      );
  }
  const impliedBalance = (snapshot: ClearedSnapshot) =>
    snapshot.activity.reduce(
      (balance, activity) => addCents(balance, activity.amountCents),
      snapshot.openingBalanceCents,
    );
  if (impliedBalance(evidence) !== evidence.closingBalanceCents)
    return insufficient(
      "Statement opening balance plus activity does not equal its closing balance. Verify the upload and signs.",
    );
  if (impliedBalance(ledger) !== ledger.closingBalanceCents)
    reasons.push(
      "Ledger opening balance plus its cleared activity does not equal the supplied closing balance.",
    );
  if (ledger.openingBalanceCents !== evidence.openingBalanceCents)
    reasons.push("Opening cleared balances differ.");

  const remaining = [...ledger.activity];
  const missingFromLedger: StatementActivity[] = [];
  for (const activity of evidence.activity) {
    const index = remaining.findIndex(
      (candidate) =>
        candidate.date === activity.date &&
        candidate.amountCents === activity.amountCents &&
        (candidate.reference && activity.reference
          ? candidate.reference === activity.reference
          : activityKey(candidate) === activityKey(activity)),
    );
    if (index < 0) missingFromLedger.push(activity);
    else remaining.splice(index, 1);
  }
  const differenceCents = centsSchema.parse(
    evidence.closingBalanceCents - ledger.closingBalanceCents,
  );
  if (differenceCents !== 0)
    reasons.push(
      "Closing cleared balances differ. No balancing adjustment was created.",
    );
  if (missingFromLedger.length || remaining.length)
    reasons.push(
      "Cleared activity differs, even if the balances happen to match.",
    );
  return {
    status: reasons.length ? "discrepancy" : "reconciled",
    differenceCents,
    reasons,
    missingFromLedger,
    missingFromStatement: remaining,
  };
}

function parseCsvRows(csv: string): string[][] {
  if (Buffer.byteLength(csv, "utf8") > 1_000_000)
    throw new Error("Statements must be no larger than 1 MB.");
  const input = csv.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const pushField = () => {
    if (field.length > 4096)
      throw new Error("A statement field exceeds 4,096 characters.");
    row.push(field);
    if (row.length > 8)
      throw new Error("Statements may have at most eight columns.");
    field = "";
    afterQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (rows.length > 5001)
      throw new Error("Statements may have at most 5,000 activity rows.");
    row = [];
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += character;
    } else if (character === ",") pushField();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      pushRow();
    } else if (character === '"' && field.length === 0 && !afterQuote)
      quoted = true;
    else {
      if (character === '"' || afterQuote)
        throw new Error("Malformed quoted field in statement CSV.");
      field += character;
    }
    if (field.length > 4096)
      throw new Error("A statement field exceeds 4,096 characters.");
  }
  if (quoted) throw new Error("Unclosed quoted field in statement CSV.");
  if (field.length || row.length || afterQuote) pushRow();
  return rows;
}

function parseSignedDollars(text: string): number {
  const value = text.trim();
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      "Statement amounts must be signed USD decimal numbers without currency symbols or separators.",
    );
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole, fractional = ""] = unsigned.split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fractional.padEnd(2, "0"));
  const signed = negative ? -cents : cents;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new Error("Statement amount exceeds safe integer cents.");
  return Number(signed);
}

export function parseStatementCsv(csv: string): StatementActivity[] {
  const rows = parseCsvRows(csv);
  const header = rows.shift()?.map((field) => field.trim().toLowerCase());
  if (
    !header?.length ||
    new Set(header).size !== header.length ||
    header.some(
      (name) => !["date", "description", "amount", "reference"].includes(name),
    ) ||
    !["date", "description", "amount"].every((name) => header.includes(name))
  ) {
    throw new Error(
      "Use CSV columns Date, Description, Amount, and optionally Reference. Amount is the signed change in account balance.",
    );
  }
  if (!rows.length) throw new Error("The statement contains no activity rows.");
  return rows.map((row, index) => {
    if (row.length !== header.length)
      throw new Error(
        `Statement row ${index + 2} has an incorrect number of columns.`,
      );
    const fields = Object.fromEntries(
      header.map((name, column) => [name, row[column]!.trim()]),
    );
    return activitySchema.parse({
      date: fields.date,
      description: fields.description,
      amountCents: parseSignedDollars(fields.amount!),
      ...(fields.reference ? { reference: fields.reference } : {}),
    });
  });
}
