import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabase } from "@/lib/supabase";
import { executeCryptoFulfillment } from "@/lib/fulfillment";

const WEBHOOK_SECRET = process.env.PROVIDER_WEBHOOK_SECRET || "";

/**
 * Computes the expected HMAC-SHA256 digest from the raw request body
 * and compares it against the signature sent in the provider's header.
 * 
 * This prevents malicious actors from spoofing payment.confirmed events
 * and triggering unauthorized Supabase writes or on-chain fulfillments.
 */
function verifySignature(rawBody: string, incomingSignature: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn("[Webhook] PROVIDER_WEBHOOK_SECRET is not set — signature verification is disabled in development.");
    return true; // Allow in dev; in prod this env var MUST be set
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
 * POST /api/webhooks/payment
 * 
 * Hardened Payment Confirmation Webhook Handler
 * 
 * 1. Extracts the raw body text BEFORE JSON parsing (required for HMAC).
 * 2. Validates the cryptographic signature from the x-webhook-signature header.
 * 3. Rejects unauthorized payloads with a strict 401 — no DB writes occur.
 * 4. On valid payment.confirmed events, marks the transaction as completed
 *    and kicks off the multi-chain fulfillment engine.
 */
export async function POST(req: NextRequest) {
  try {
    // ──────────────────────────────────────────────────────────────
    // 1. Read the raw body as text for HMAC computation
    // ──────────────────────────────────────────────────────────────
    const rawBody = await req.text();

    // ──────────────────────────────────────────────────────────────
    // 2. Cryptographic Signature Verification
    // ──────────────────────────────────────────────────────────────
    const incomingSignature = req.headers.get("x-webhook-signature") || "";

    if (!verifySignature(rawBody, incomingSignature)) {
      console.error("[Webhook] Signature verification FAILED — potential spoofing attempt.");
      return NextResponse.json(
        { error: "Unauthorized. Invalid webhook signature." },
        { status: 401 }
      );
    }

    // ──────────────────────────────────────────────────────────────
    // 3. Parse the verified body
    // ──────────────────────────────────────────────────────────────
    let payload: { event?: string; data?: { reference?: string } };
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

    // ──────────────────────────────────────────────────────────────
    // 4. Event Type Filtering
    // ──────────────────────────────────────────────────────────────
    if (event !== "payment.confirmed") {
      // Acknowledge receipt of non-actionable events so the provider
      // does not keep retrying them.
      return NextResponse.json({ received: true, ignored: true });
    }

    const transactionReference = data.reference;
    console.log(`[Webhook] ✓ Verified. Processing confirmed payment: ${transactionReference}`);

    // ──────────────────────────────────────────────────────────────
    // 5. Update the Supabase ledger row to "completed"
    // ──────────────────────────────────────────────────────────────
    const { data: updatedTx, error: updateError } = await supabase
      .from("transactions")
      .update({
        status: "completed",
      })
      .eq("id", transactionReference)
      .select()
      .single();

    if (updateError || !updatedTx) {
      console.error("[Webhook] Supabase Update Error:", updateError);
      return NextResponse.json(
        { error: "Transaction record not found or update failed." },
        { status: 404 }
      );
    }

    console.log(`[Webhook] ✓ Transaction ${updatedTx.id} marked completed. Initiating fulfillment.`);

    // ──────────────────────────────────────────────────────────────
    // 6. Trigger the On-Chain Fulfillment Engine (fire-and-forget)
    //    The fulfillment function writes the on-chain hash back to
    //    Supabase independently. We do not block the webhook response.
    // ──────────────────────────────────────────────────────────────
    const targetNetwork = (updatedTx.network as "base" | "solana") || "base";

    executeCryptoFulfillment(
      updatedTx.id,
      updatedTx.wallet_address,
      Number(updatedTx.crypto_amount),
      targetNetwork
    ).catch((err) => {
      console.error(`[Webhook] Fulfillment failed for tx ${updatedTx.id}:`, err);
    });

    return NextResponse.json({ success: true, settled_id: updatedTx.id });

  } catch (error) {
    console.error("[Webhook] Processing Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error during webhook processing." },
      { status: 500 }
    );
  }
}
