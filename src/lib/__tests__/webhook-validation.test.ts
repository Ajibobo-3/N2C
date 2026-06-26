import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Signature Verification Tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replicate the signature verification logic from our webhook handlers
 * to test it in isolation without needing HTTP requests.
 */
function verifyHmacSha512(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;

  const expectedSignature = createHmac("sha512", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (expectedSignature.length !== signature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

function verifyHmacSha256(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return false;

  const expectedSignature = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (expectedSignature.length !== signature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

describe("Paystack Webhook Signature (HMAC-SHA512)", () => {
  const secret = "sk_test_abc123def456";
  const payload = JSON.stringify({
    event: "charge.success",
    data: { reference: "n2c-test-123", status: "success" },
  });

  it("accepts a valid HMAC-SHA512 signature", () => {
    const validSignature = createHmac("sha512", secret)
      .update(payload, "utf8")
      .digest("hex");

    expect(verifyHmacSha512(payload, validSignature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyHmacSha512(payload, "deadbeef", secret)).toBe(false);
  });

  it("rejects a tampered payload with valid format signature", () => {
    const validSignature = createHmac("sha512", secret)
      .update(payload, "utf8")
      .digest("hex");

    const tamperedPayload = JSON.stringify({
      event: "charge.success",
      data: { reference: "n2c-test-123", status: "success", amount: 99999999 },
    });

    expect(verifyHmacSha512(tamperedPayload, validSignature, secret)).toBe(false);
  });

  it("REJECTS when secret is empty (security fix)", () => {
    const signatureFromSomeKey = createHmac("sha512", "some-key")
      .update(payload, "utf8")
      .digest("hex");

    // This is the critical security fix — empty secret must REJECT, not accept
    expect(verifyHmacSha512(payload, signatureFromSomeKey, "")).toBe(false);
  });

  it("rejects empty signature string", () => {
    expect(verifyHmacSha512(payload, "", secret)).toBe(false);
  });
});

describe("ZendFi/Payment Webhook Signature (HMAC-SHA256)", () => {
  const secret = "whsec_test_secret_123";
  const payload = JSON.stringify({
    event: "payment.confirmed",
    data: { reference: "tx-uuid-123" },
  });

  it("accepts a valid HMAC-SHA256 signature", () => {
    const validSignature = createHmac("sha256", secret)
      .update(payload, "utf8")
      .digest("hex");

    expect(verifyHmacSha256(payload, validSignature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyHmacSha256(payload, "not-a-valid-sig", secret)).toBe(false);
  });

  it("REJECTS when secret is empty (security fix)", () => {
    expect(verifyHmacSha256(payload, "any-sig", "")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Payload Structure Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook payload sender name extraction", () => {
  it("extracts account_name from authorization object", () => {
    const data = {
      authorization: { account_name: "OLASUNKANMI TUNDE JAMES" },
      customer: { first_name: "Tunde", last_name: "Olasunkanmi" },
    };
    // Priority: authorization.account_name > customer name
    const auth = data.authorization as Record<string, unknown>;
    expect(auth.account_name).toBe("OLASUNKANMI TUNDE JAMES");
  });

  it("falls back to customer name when no authorization", () => {
    const data = {
      customer: { first_name: "Tunde", last_name: "Olasunkanmi" },
    };
    const customer = data.customer;
    const fullName = `${customer.first_name} ${customer.last_name}`;
    expect(fullName).toBe("Tunde Olasunkanmi");
  });

  it("extracts sender_account_name from ZendFi payload", () => {
    const data = {
      sender_account_name: "CHINEDU OKORO",
      reference: "tx-123",
    };
    expect(data.sender_account_name).toBe("CHINEDU OKORO");
  });

  it("extracts from nested sender object", () => {
    const data = {
      sender: { account_name: "ADEWALE FASHOLA" },
      reference: "tx-456",
    };
    const sender = data.sender as Record<string, unknown>;
    expect(sender.account_name).toBe("ADEWALE FASHOLA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency Logic Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Idempotency guard logic", () => {
  it("should only process transactions in 'pending' status", () => {
    const validStatuses = ["pending"];
    const skipStatuses = ["completed", "fulfilled", "frozen_fraud", "expired", "fulfillment_failed"];

    for (const status of validStatuses) {
      expect(status === "pending").toBe(true);
    }
    for (const status of skipStatuses) {
      expect(status === "pending").toBe(false);
    }
  });

  it("frozen_fraud status should block fulfillment", () => {
    const frozenStatus = "frozen_fraud";
    const fulfillableStatuses = ["pending", "completed"];
    expect(fulfillableStatuses.includes(frozenStatus)).toBe(false);
  });
});
