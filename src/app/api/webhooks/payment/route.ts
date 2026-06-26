import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabase } from "@/lib/supabase";
import { executeCryptoFulfillment } from "@/lib/fulfillment";
import { validateWebhookSender, flagFraud } from "@/lib/fraud-guard";

const WEBHOOK_SECRET = process.env.PROVIDER_WEBHOOK_SECRET || "";

/**
 * Computes the expected HMAC-SHA256 digest from the raw request body
 * and compares it against the signature sent in the provider's header.
 *
 * SECURITY: If the secret is not configured, ALL webhooks are REJECTED.
 */
function verifySignature(rawBody: string, incomingSignature: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.error(
      "[Payment Webhook] CRITICAL: PROVIDER_WEBHOOK_SECRET is not configured. Rejecting all webhooks."
    );
    return false;
  }

  const expectedSignature = createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (expectedSignature.length !== incomingSignature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ incomingSignature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Extracts the sender's bank account name from the ZendFi/provider webhook payload.
 */
function extractSenderName(data: Record<string, unknown>): string {
  // ZendFi typically sends sender_account_name or sender.account_name
  if (typeof data.sender_account_name === "string") {
    return data.sender_account_name;
  }

  const sender = data.sender as Record<string, unknown> | undefined;
  if (sender && typeof sender.account_name === "string") {
    return sender.account_name;
  }

  // Fallback: check for account_name at top level
  if (typeof data.account_name === "string") {
    return data.account_name;
  }

  return "";
}

/**
 * POST /api/webhooks/payment
 *
 * Hardened Payment Confirmation Webhook Handler
 *
 * Security features:
 * - HMAC-SHA256 signature verification (REJECTS if secret is missing)
 * - Atomic idempotency guard (prevents double-payout race condition)
 * - Sender name verification against registered KYC legal name
 * - Fraud flagging with admin alerts on mismatch
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Read the raw body as text for HMAC computation
    const rawBody = await req.text();

    // 2. Cryptographic Signature Verification
    const incomingSignature = req.headers.get("x-webhook-signature") || "";

    if (!verifySignature(rawBody, incomingSignature)) {
      console.error("[Payment Webhook] Signature verification FAILED — potential spoofing attempt.");
      return NextResponse.json(
        { error: "Unauthorized. Invalid webhook signature." },
        { status: 401 }
      );
    }

    // 3. Parse the verified body
    let payload: { event?: string; data?: Record<string, unknown> & { reference?: string } };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload." },
        { status: 400 }
      );
    }

    const { event, data } = payload;

    if (!event || !data || !data.reference) {
      return NextResponse.json(
        { error: "Invalid webhook payload structure." },
        { status: 400 }
      );
    }

    // 4. Event Type Filtering
    if (event !== "payment.confirmed") {
      return NextResponse.json({ received: true, ignored: true });
    }

    const transactionReference = data.reference;
    console.log(`[Payment Webhook] ✓ Verified. Processing confirmed payment: ${transactionReference}`);

    // 5. ATOMIC idempotency guard — claim the transaction with a single atomic update.
    //    Only succeeds if the current status is 'pending'. Prevents double-payout.
    const { data: claimedTx, error: claimError } = await supabase
      .from("transactions")
      .update({ status: "completed" })
      .eq("id", transactionReference)
      .eq("status", "pending")
      .select()
      .single();

    if (claimError || !claimedTx) {
      console.log(
        `[Payment Webhook] Transaction ${transactionReference} not found or already processed. Skipping.`
      );
      return NextResponse.json({ success: true, already_processed: true });
    }

    // 6. ANTI-FRAUD: Sender name verification
    const senderName = extractSenderName(data);
    if (senderName) {
      const validation = await validateWebhookSender(supabase, claimedTx.id, senderName);

      if (!validation.valid) {
        console.warn(`[Payment Webhook] 🚨 FRAUD DETECTED for tx ${claimedTx.id}: ${validation.reason}`);
        await flagFraud(supabase, claimedTx.id, "SENDER_NAME_MISMATCH", {
          sender_name: senderName,
          reason: validation.reason,
          provider_reference: transactionReference,
        });
        // Acknowledge to provider (200) but DO NOT fulfill
        return NextResponse.json({ success: true, fraud_flagged: true });
      }
    }

    console.log(`[Payment Webhook] ✓ Transaction ${claimedTx.id} marked completed. Initiating fulfillment.`);

    // 7. Fulfillment with error handling
    const targetNetwork = (claimedTx.network as "base" | "solana") || "base";

    try {
      await executeCryptoFulfillment(
        claimedTx.id,
        claimedTx.wallet_address,
        Number(claimedTx.crypto_amount),
        targetNetwork
      );
    } catch (err) {
      console.error(`[Payment Webhook] Fulfillment failed for tx ${claimedTx.id}:`, err);
      await supabase
        .from("transactions")
        .update({ status: "fulfillment_failed" })
        .eq("id", claimedTx.id);
    }

    return NextResponse.json({ success: true, settled_id: claimedTx.id });

  } catch (error) {
    console.error("[Payment Webhook] Processing Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error during webhook processing." },
      { status: 500 }
    );
  }
}
