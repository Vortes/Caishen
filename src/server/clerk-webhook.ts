import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";

const MAX_BODY_BYTES = 256 * 1024;

export class ClerkWebhookError extends Error {
  constructor(
    public readonly status: 400 | 413 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ClerkWebhookError";
  }
}

function configuredSecret(value: string | undefined): string {
  const secret = value?.trim();
  const encoded = secret?.startsWith("whsec_") ? secret.slice(6) : "";
  const decoded = Buffer.from(encoded, "base64");
  if (
    !secret ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    !decoded.length ||
    decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
  ) {
    throw new ClerkWebhookError(
      503,
      "Clerk webhook signing is not configured.",
    );
  }
  return secret;
}

async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new ClerkWebhookError(413, "Clerk webhook body is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader)
    throw new ClerkWebhookError(400, "Invalid Clerk webhook request.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ClerkWebhookError(413, "Clerk webhook body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function verifyClerkRequest(
  request: Request,
  signingSecret: string | undefined,
): Promise<{ messageId: string; event: WebhookEvent }> {
  const secret = configuredSecret(signingSecret);
  const messageId = request.headers.get("svix-id")?.trim();
  const timestamp = request.headers.get("svix-timestamp")?.trim();
  const signature = request.headers.get("svix-signature")?.trim();
  if (
    !messageId ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(messageId) ||
    !timestamp ||
    !/^\d{1,13}$/.test(timestamp) ||
    !signature ||
    signature.length > 4096
  ) {
    throw new ClerkWebhookError(400, "Invalid Clerk webhook request.");
  }
  try {
    const body = await boundedBody(request);
    const verifiedRequest = new NextRequest(request.url, {
      method: "POST",
      headers: {
        "svix-id": messageId,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      },
      body,
    });
    const event = await verifyWebhook(verifiedRequest, {
      signingSecret: secret,
    });
    return { messageId, event };
  } catch (error) {
    if (error instanceof ClerkWebhookError) throw error;
    throw new ClerkWebhookError(400, "Invalid Clerk webhook request.");
  }
}
