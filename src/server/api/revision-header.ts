/** The response header carrying the household revision (ADR 0006). */
export const REVISION_HEADER = "x-caishen-revision";

/**
 * The household revisions a request saw, for the revision header: a browser
 * that sees a revision it doesn't hold pulls what it missed.
 */
export class ObservedRevision {
  value: number | undefined;
  observe = (revision: number) => {
    this.value = Math.max(this.value ?? revision, revision);
  };
}

/**
 * tRPC's responseMeta: every response carries the latest household revision
 * its request saw. Streamed responses send headers before any procedure
 * ran, so they carry none; the sync layer's link doesn't stream.
 */
export function revisionResponseMeta({
  ctx,
  eagerGeneration,
}: {
  ctx?: { revision: ObservedRevision };
  eagerGeneration: boolean;
}) {
  return !eagerGeneration && ctx?.revision.value !== undefined
    ? { headers: { [REVISION_HEADER]: String(ctx.revision.value) } }
    : {};
}
