import type { User } from "@clerk/backend";
import type { APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

const key = Buffer.from("caishen-e2e-profile-webhook-key");
export const clerkWebhookSecret = `whsec_${key.toString("base64")}`;

// Clerk cannot deliver to the managed localhost server. Send the real test
// user's profile through the same signed HTTP boundary as its webhook.
export async function deliverClerkProfile(
  request: APIRequestContext,
  user: User,
) {
  const body = JSON.stringify({
    object: "event",
    type: "user.updated",
    timestamp: Date.now(),
    data: {
      id: user.id,
      object: "user",
      updated_at: user.updatedAt,
      first_name: user.firstName,
      last_name: user.lastName,
      image_url: user.imageUrl,
      primary_email_address_id: user.primaryEmailAddressId,
      email_addresses: user.emailAddresses.map((email) => ({
        id: email.id,
        email_address: email.emailAddress,
      })),
    },
  });
  const id = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const response = await request.post("/api/webhooks/clerk", {
    data: body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  });
  if (!response.ok())
    throw new Error(`Profile webhook failed: ${response.status()}`);
}
