import { z } from "zod";

// What Plaid Link reports on completion. Type and subtype arrived later, so
// a browser running an older build may still send accounts without them.
export const plaidLinkMetadataSchema = z.object({
  institution: z
    .object({ institution_id: z.string().min(1).max(256) })
    .nullable(),
  accounts: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        name: z.string().max(1024).nullable(),
        mask: z.string().max(20).nullable(),
        type: z.string().max(64).nullable().optional(),
        subtype: z.string().max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export type PlaidLinkMetadata = z.infer<typeof plaidLinkMetadataSchema>;
