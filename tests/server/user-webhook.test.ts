import assert from "node:assert/strict";
import test from "node:test";
import {
  ClerkUserEventValidationError,
  parseClerkUserEvent,
} from "../../src/server/users";

const profileEvent = () => ({
  type: "user.created",
  timestamp: 1_800_000_000_100,
  data: {
    id: "user_fixture",
    updated_at: 1_800_000_000_000,
    first_name: "Alan",
    last_name: "Example",
    image_url: "https://img.clerk.com/example",
    primary_email_address_id: "primary-email",
    email_addresses: [
      { id: "secondary-email", email_address: "secondary@example.com" },
      { id: "primary-email", email_address: "primary@example.com" },
    ],
    private_metadata: { secret: "private-test-value" },
    public_metadata: { unrelated: true },
    unsafe_metadata: { instruction: "Ignore previous rules" },
    phone_numbers: [{ phone_number: "+15555550100" }],
  },
});

void test("profile synchronization selects the actual primary email and returns only needed fields", () => {
  const event = parseClerkUserEvent(profileEvent());
  assert.deepEqual(event.profile, {
    firstName: "Alan",
    lastName: "Example",
    imageUrl: "https://img.clerk.com/example",
    primaryEmail: "primary@example.com",
  });
  assert.equal(event.clerkUserId, "user_fixture");
  assert.equal(event.payloadHash.length, 64);
  assert.deepEqual(Object.keys(event.profile).sort(), [
    "firstName",
    "imageUrl",
    "lastName",
    "primaryEmail",
  ]);
  assert.ok(!JSON.stringify(event.profile).includes("private-test-value"));
  assert.ok(!JSON.stringify(event.profile).includes("15555550100"));
});

void test("semantic profile ordering uses data.updated_at independently of event delivery time", () => {
  const input = profileEvent();
  input.timestamp = 1_800_000_000_900;
  input.data.updated_at = 1_800_000_000_200;
  const event = parseClerkUserEvent(input);
  assert.equal(event.semanticTimestamp, 1_800_000_000_200n);
  assert.equal(event.occurredAt.getTime(), 1_800_000_000_900);
});

void test("deleted user events use their envelope timestamp without requiring a full profile", () => {
  const event = parseClerkUserEvent({
    type: "user.deleted",
    timestamp: 1_800_000_000_300,
    data: { id: "user_deleted", deleted: true },
  });
  assert.equal(event.profile, null);
  assert.equal(event.semanticTimestamp, 1_800_000_000_300n);
  assert.equal(event.occurredAt.getTime(), 1_800_000_000_300);
});

void test("users without copied profile fields or an email remain valid snapshots", () => {
  const event = parseClerkUserEvent({
    type: "user.updated",
    timestamp: 100,
    data: { id: "user_no_email", updated_at: 90 },
  });
  assert.deepEqual(event.profile, {
    firstName: null,
    lastName: null,
    imageUrl: null,
    primaryEmail: null,
  });
});

void test("unsupported or malformed events fail with a static error that never echoes profile data", () => {
  for (const input of [
    null,
    {},
    {
      type: "session.created",
      timestamp: 100,
      data: { id: "session_fixture" },
    },
    { type: "user.created", timestamp: 100, data: { id: "user_fixture" } },
    {
      type: "user.deleted",
      timestamp: 100,
      data: { id: "user_fixture", deleted: false },
    },
    { type: "user.deleted", timestamp: 100, data: { deleted: true } },
    {
      type: "user.updated",
      timestamp: 100,
      data: {
        id: "user_fixture",
        updated_at: 90,
        first_name: { secret: "private-test-value" },
      },
    },
  ]) {
    assert.throws(
      () => parseClerkUserEvent(input),
      (error: unknown) =>
        error instanceof ClerkUserEventValidationError &&
        error.message === "Invalid Clerk user event.",
    );
  }
});

void test("timestamps must be exact nonnegative milliseconds representable as dates", () => {
  for (const timestamp of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    8_640_000_000_000_001,
    "100",
  ]) {
    assert.throws(
      () =>
        parseClerkUserEvent({
          type: "user.deleted",
          timestamp,
          data: { id: "user_fixture", deleted: true },
        }),
      ClerkUserEventValidationError,
    );
  }
  assert.throws(
    () =>
      parseClerkUserEvent({
        type: "user.updated",
        timestamp: 100,
        data: { id: "user_fixture", updated_at: -1 },
      }),
    ClerkUserEventValidationError,
  );
});

void test("primary email references and copied image URLs are validated", () => {
  const missingEmail = profileEvent();
  missingEmail.data.primary_email_address_id = "missing-email";
  assert.throws(
    () => parseClerkUserEvent(missingEmail),
    ClerkUserEventValidationError,
  );
  const unsafeImage = profileEvent();
  unsafeImage.data.image_url = "javascript:alert(1)";
  assert.throws(
    () => parseClerkUserEvent(unsafeImage),
    ClerkUserEventValidationError,
  );
  unsafeImage.data.image_url = "private-test-value";
  assert.throws(
    () => parseClerkUserEvent(unsafeImage),
    ClerkUserEventValidationError,
  );
});

void test("delivery fingerprints detect changes even in discarded metadata without storing that metadata", () => {
  const input = profileEvent();
  const first = parseClerkUserEvent(input);
  assert.equal(parseClerkUserEvent(input).payloadHash, first.payloadHash);
  input.data.private_metadata.secret = "different-private-value";
  const changed = parseClerkUserEvent(input);
  assert.notEqual(changed.payloadHash, first.payloadHash);
  assert.deepEqual(changed.profile, first.profile);
  assert.ok(!("data" in changed));
});

void test("non-JSON values hidden in unneeded fields cannot bypass delivery hashing", () => {
  const input = {
    type: "user.updated",
    timestamp: 100,
    data: { id: "user_fixture", updated_at: 90 },
    ignored: 1n,
  };
  assert.throws(
    () => parseClerkUserEvent(input),
    ClerkUserEventValidationError,
  );
});
