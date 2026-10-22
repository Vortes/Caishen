import {
  httpBatchLink,
  httpBatchStreamLink,
  httpLink,
  splitLink,
  type TRPCLink,
} from "@trpc/client";
import { observable } from "@trpc/server/observable";
import SuperJSON from "superjson";
import { RevisionSignal } from "~/components/sync/revision-signal";
import type { AppRouter } from "~/server/api/root";

// How the browser talks to the API. The sync layer's calls go one request
// each, so the household revision header (ADR 0006) on each answer is that
// call's own. Other writes are batched without streaming, so their answers
// still carry the header; queries are batched and streamed, which sends
// headers before any procedure ran, so they carry none.

const REVISION_HEADER = "x-caishen-revision";

/** Every household revision a response reported, for the budget client. */
export const serverRevisions = new RevisionSignal();

function reportRevision(meta: unknown) {
  const response = (meta as { response?: unknown } | undefined)?.response;
  if (!(response instanceof Response)) return;
  const revision = Number(response.headers.get(REVISION_HEADER) ?? NaN);
  if (Number.isSafeInteger(revision) && revision >= 0)
    serverRevisions.emit({ revision });
}

// Reports the revision on answers and refusals alike: a refusal can come
// from changes this browser hasn't pulled yet. A pull's own answer is left
// out: the pull brings what it reports, and a failed one is retried on its
// own schedule, never again at once.
const revisionLink: TRPCLink<AppRouter> =
  () =>
  ({ next, op }) =>
    observable((observer) => {
      const report = op.path !== "sync.pull";
      return next(op).subscribe({
        next(value) {
          if (report) reportRevision(value.context);
          observer.next(value);
        },
        error(error) {
          if (report) reportRevision(error.meta);
          observer.error(error);
        },
        complete() {
          observer.complete();
        },
      });
    });

/** The calls whose answers the budget client reads revisions from. */
const syncPaths = new Set(["budget.execute", "sync.pull"]);

export function appLinks({
  url,
  fetch,
}: {
  url: string;
  fetch?: typeof globalThis.fetch;
}): TRPCLink<AppRouter>[] {
  const options = {
    transformer: SuperJSON,
    url,
    fetch,
    headers: () => ({ "x-trpc-source": "nextjs-react" }),
  };
  return [
    revisionLink,
    splitLink({
      condition: (op) => syncPaths.has(op.path),
      true: httpLink(options),
      false: splitLink({
        condition: (op) => op.type === "mutation",
        true: httpBatchLink(options),
        false: httpBatchStreamLink(options),
      }),
    }),
  ];
}
