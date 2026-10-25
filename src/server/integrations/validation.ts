import { z } from "zod";

export const centsSchema = z.number().int().safe();
export const providerIdSchema = z.string().min(1).max(256);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date in YYYY-MM-DD format");

export class IntegrationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string,
    /** The provider's id for the failed request, when it answered at all. */
    public readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export async function readJsonResponse(
  response: Response,
  provider: string,
  maxBytes = 8_000_000,
): Promise<unknown> {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes)
    throw new IntegrationError(
      provider,
      "RESPONSE_TOO_LARGE",
      `${provider} returned too much data.`,
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new IntegrationError(
      provider,
      "INVALID_RESPONSE",
      `${provider} returned an empty response.`,
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new IntegrationError(
        provider,
        "RESPONSE_TOO_LARGE",
        `${provider} returned too much data.`,
      );
    }
    chunks.push(value);
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    throw new IntegrationError(
      provider,
      "INVALID_RESPONSE",
      `${provider} returned invalid JSON.`,
    );
  }
}

export function usdToCents(amount: number): number {
  const cents = Math.round(amount * 100);
  if (
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(cents) ||
    Math.abs(amount * 100 - cents) > 0.00001
  ) {
    throw new Error(
      "USD amounts must have at most two decimal places and fit safe integer cents.",
    );
  }
  return cents === 0 ? 0 : cents;
}

export function addCents(left: number, right: number): number {
  return centsSchema.parse(left + right);
}
