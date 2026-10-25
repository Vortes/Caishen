import { z } from "zod";

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
      }),
    )
    .min(1)
    .max(1000),
});

export type PlaidLinkMetadata = z.infer<typeof plaidLinkMetadataSchema>;
