import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabase } from "@/lib/supabase";
import { executeCryptoFulfillment } from "@/lib/fulfillment";
import { validateWebhookSender, flagFraud } from "@/lib/fraud-guard";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

/**
 * Verify the Paystack webhook signature.
 * Paystack signs webhooks with HMAC-SHA512 using your secret key.
 * The signature is sent in the `x-paystack-signature` header.
 *
 * SECURITY: If the secret key is not configured, ALL webhooks are REJECTED.
 */
function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  if (!PAYSTACK_SECRET_KEY) {
    console.error(
      "[Paystack Webhook] CRITICAL: PAYSTACK_SECRET_KEY is not configured. Rejecting all webhooks."
    );
    return false;
  }

  const expectedSignature = createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(rawBody, "utf8")
    .digest("hex");

  // Constant-time comparison
  if (expectedSignature.length !== signature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Extracts the sender's bank account name from a Paystack charge.success payload.
 * Paystack includes authorization details with the payer's account name.
 */
function extractSenderName(data: Record<string, unknown>): string {
  // Try authorization.account_name first (bank transfer / direct debit)
  const auth = data.authorization as Record<string, unknown> | undefined;
  if (auth?.account_name && typeof auth.account_name === "string") {
    return auth.account_name;
  }

  // Fallback to customer name fields (card payments)
  const customer = data.customer as Record<string, unknown> | undefined;
  if (customer) {
    const parts = [customer.first_name, customer.last_name]
      .filter((p) => typeof p === "string" && p.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }

  return "";
}

/**
 * POST /api/webhooks/paystack
 *
 * Hardened Paystack Webhook Handler
 *
 * Security features:
 * - HMAC-SHA512 signature verification (REJECTS if secret is missing)
 * - Atomic idempotency guard (prevents double-payout race condition)
 * - Sender name verification against registered KYC legal name
 * - Fraud flagging with admin alerts on mismatch
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Read raw body
    const rawBody = await req.text();

    // 2. Signature verification
    const signature = req.headers.get("x-paystack-signature") || "";

    if (!verifyPaystackSignature(rawBody, signature)) {
      console.error("[Paystack Webhook] Signature verification FAILED.");
      return NextResponse.json(
        { error: "Unauthorized. Invalid signature." },
        { status: 401 }
      );
    }

    // 3. Parse the verified body
    let payload: {
      event?: string;
      data?: Record<string, unknown> & {
        reference?: string;
        status?: string;
        metadata?: { transaction_id?: string };
      };
    };

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON payload." },
        { status: 400 }
      );
    }

    const { event, data } = payload;

    // Acknowledge non-actionable events
    if (event !== "charge.success") {
      return NextResponse.json({ received: true, ignored: true });
    }

    if (!data?.reference) {
      return NextResponse.json(
        { error: "Missing reference in payload." },
        { status: 400 }
      );
    }

    console.log(`[Paystack Webhook] ✓ Verified charge.success for reference: ${data.reference}`);

    // 4. Look up the transaction by provider_reference
    const { data: tx, error: lookupError } = await supabase
      .from("transactions")
      .select("*")
      .eq("provider_reference", data.reference)
      .single();

    if (lookupError || !tx) {
      console.error("[Paystack Webhook] Transaction not found for reference:", data.reference);
      return NextResponse.json(
        { error: "Transaction not found." },
        { status: 404 }
      );
    }

    // 5. ATOMIC idempotency guard — claim the transaction with a single atomic update.
    //    Only succeeds if the current status is 'pending'. If another process
    //    (e.g. /api/paystack/verify) already claimed it, 0 rows are updated.
    const { data: claimedRows, error: claimError } = await supabase
      .from("transactions")
      .update({ status: "completed" })
      .eq("id", tx.id)
      .eq("status", "pending")
      .select("id")
      .single();

    if (claimError || !claimedRows) {
      console.log(`[Paystack Webhook] Transaction ${tx.id} already claimed by another process. Skipping.`);
      return NextResponse.json({ success: true, already_processed: true });
    }

    // 6. ANTI-FRAUD: Sender name verification
    const senderName = extractSenderName(data);
    if (senderName) {
      const validation = await validateWebhookSender(supabase, tx.id, senderName);

      if (!validation.valid) {
        console.warn(`[Paystack Webhook] 🚨 FRAUD DETECTED for tx ${tx.id}: ${validation.reason}`);
        await flagFraud(supabase, tx.id, "SENDER_NAME_MISMATCH", {
          sender_name: senderName,
          reason: validation.reason,
          paystack_reference: data.reference,
        });
        // Acknowledge to Paystack (200) but DO NOT fulfill
        return NextResponse.json({ success: true, fraud_flagged: true });
      }
    }

    console.log(`[Paystack Webhook] ✓ Transaction ${tx.id} marked completed. Initiating fulfillment.`);

    // 7. Fulfillment with error handling
    const targetNetwork = (tx.network as "base" | "solana") || "base";

    try {
      await executeCryptoFulfillment(
        tx.id,
        tx.wallet_address,
        Number(tx.crypto_amount),
        targetNetwork
      );
    } catch (err) {
      console.error(`[Paystack Webhook] Fulfillment failed for tx ${tx.id}:`, err);
      // Mark as fulfillment_failed so the cron job can retry
      await supabase
        .from("transactions")
        .update({ status: "fulfillment_failed" })
        .eq("id", tx.id);
    }

    return NextResponse.json({ success: true, settled_id: tx.id });
  } catch (error) {
    console.error("[Paystack Webhook] Processing error:", error);
    return NextResponse.json(
      { error: "Internal Server Error." },
      { status: 500 }
    );
  }
}
