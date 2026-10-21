/**
 * JSON with object keys sorted at every level, so values that are equal as
 * JSON serialize identically whatever order their keys were written in, for
 * example after a round trip through a jsonb column.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );
}
