import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import type { PlaidWebhookKey } from "../src/server/plaid-webhook";

// Signs webhook bodies the way Plaid does: an ES256 JWT in the
// Plaid-Verification header whose payload names the body's SHA-256.

/** A signing key as Plaid publishes it: the public half as a JWK with its id. */
export function signingKey(keyId: string) {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const key: PlaidWebhookKey = {
    alg: "ES256",
    crv: "P-256",
    kid: keyId,
    kty: "EC",
    use: "sig",
    x: jwk.x!,
    y: jwk.y!,
    created_at: 1_700_000_000,
    expired_at: null,
  };
  return { key, privateKey: pair.privateKey };
}

export const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64url");

export function verificationHeader(
  body: string,
  privateKey: KeyObject,
  {
    keyId,
    issuedAt,
    hash = createHash("sha256").update(body).digest("hex"),
  }: { keyId: string; issuedAt: number; hash?: string },
) {
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
  );
  const payload = base64url(
    JSON.stringify({ iat: Math.floor(issuedAt), request_body_sha256: hash }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

export function signedRequest(
  body: string,
  privateKey: KeyObject,
  options: { keyId: string; issuedAt: number; hash?: string },
) {
  return new Request("https://caishen.example/api/webhooks/plaid", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "plaid-verification": verificationHeader(body, privateKey, options),
    },
    body,
  });
}
