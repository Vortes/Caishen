import { z } from "zod";

import { centsSchema, dateSchema } from "~/server/integrations/validation";

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
