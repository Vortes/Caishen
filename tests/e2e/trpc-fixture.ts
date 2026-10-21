import type { Request, Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import superjson from "superjson";
import { z } from "zod";

export function readTrpcCalls(
  request: Pick<Request, "url" | "method" | "postDataJSON">,
) {
  const url = new URL(request.url());
  const procedures = url.pathname
    .slice(url.pathname.lastIndexOf("/") + 1)
    .split(",");
  const payload: unknown =
    request.method() === "GET"
      ? JSON.parse(url.searchParams.get("input") ?? "null")
      : request.postDataJSON();
  const inputs = url.searchParams.has("batch")
    ? z.record(z.unknown()).parse(payload)
    : { 0: payload };
  return procedures.map((procedure, index) => {
    if (!(index in inputs))
      throw new Error(`Missing input for ${procedure} at ${index}`);
    return {
      procedure,
      input: superjson.deserialize(
        inputs[index] as ReturnType<typeof superjson.serialize>,
      ),
    };
  });
}

export async function respondTrpc(
  route: {
    request: () => Pick<Request, "url" | "headers">;
    fulfill: Route["fulfill"];
  },
  values: unknown[],
) {
  const request = route.request();
  if (request.headers()["trpc-accept"] === "application/jsonl") {
    const stream = jsonlStreamProducer({
      data: Object.fromEntries(
        values.map((data, index) => [index, { result: { data } }]),
      ),
      serialize: superjson.serialize,
    });
    await route.fulfill({
      contentType: "application/jsonl",
      body: await new Response(stream).text(),
    });
    return;
  }
  const results = values.map((data) => ({
    result: { data: superjson.serialize(data) },
  }));
  await route.fulfill({
    json: new URL(request.url()).searchParams.has("batch")
      ? results
      : results[0],
  });
}
