import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTRPCUntypedClient,
  httpBatchLink,
  httpBatchStreamLink,
  httpLink,
} from "@trpc/client";
import superjson from "superjson";
import { readTrpcCalls, respondTrpc } from "../e2e/trpc-fixture";

for (const link of [httpBatchStreamLink, httpBatchLink, httpLink]) {
  for (const method of ["query", "mutation"] as const) {
    void test(`${link.name} fixture answers every ${method} call with its own input`, async () => {
      const seen: ReturnType<typeof readTrpcCalls>[] = [];
      const client = createTRPCUntypedClient({
        links: [
          link({
            url: "http://fixture.test/api/trpc",
            transformer: superjson,
            fetch: async (url, init) => {
              const request = new Request(url, init);
              const body = await request.text();
              const calls = readTrpcCalls({
                url: () => request.url,
                method: () => request.method,
                postDataJSON: (): unknown => JSON.parse(body),
              });
              seen.push(calls);
              let response!: Response;
              await respondTrpc(
                {
                  request: () => ({
                    url: () => request.url,
                    headers: () => Object.fromEntries(request.headers),
                  }),
                  fulfill: async ({ body, json, contentType } = {}) => {
                    response = new Response(
                      json ? JSON.stringify(json) : body?.toString(),
                      {
                        headers: {
                          "content-type": contentType ?? "application/json",
                        },
                      },
                    );
                  },
                },
                calls.map(({ input }) => input),
              );
              return response;
            },
          }),
        ],
      });
      const values = [
        { month: "2026-10", at: new Date("2026-10-01T00:00:00Z") },
        { month: "2026-11", at: new Date("2026-11-01T00:00:00Z") },
      ];
      const result = await Promise.all(
        values.map((value) => client[method]("budget.state", value)),
      );
      assert.deepEqual(result, values);
      assert.deepEqual(
        seen.flat(),
        values.map((input) => ({ procedure: "budget.state", input })),
      );
      assert.equal(seen.length, link === httpLink ? 2 : 1);
    });
  }
}
