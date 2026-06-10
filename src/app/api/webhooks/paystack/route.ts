import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabase } from "@/lib/supabase";
import { executeCryptoFulfillment } from "@/lib/fulfillment";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

/**
 * Verify the Paystack webhook signature.
 * Paystack signs webhooks with HMAC-SHA512 using your secret key.
 * The signature is sent in the `x-paystack-signature` header.
 */
function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  if (!PAYSTACK_SECRET_KEY) {
    console.warn("[Paystack Webhook] PAYSTACK_SECRET_KEY is not set — signature verification disabled in development.");
    return true;
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
 * POST /api/webhooks/paystack
 *
 * Paystack Webhook Handler
 *
 * Belt-and-suspenders safety net alongside the /api/paystack/verify route.
 * Catches payments where the user closes the browser before the frontend
 * can call verify (e.g. mobile browser crash, network drop after payment).
 *
 * Flow:
 * 1. Read raw body for HMAC computation
 * 2. Validate x-paystack-signature (HMAC-SHA512)
 * 3. Filter for charge.success events only
 * 4. Look up transaction by provider_reference
 * 5. Idempotent status update → trigger fulfillment
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
      data?: {
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

    // 5. Idempotency guard
    if (tx.status === "completed" || tx.status === "fulfilled") {
      console.log(`[Paystack Webhook] Transaction ${tx.id} already processed. Skipping.`);
      return NextResponse.json({ success: true, already_processed: true });
    }

    // 6. Mark as completed
    const { error: updateError } = await supabase
      .from("transactions")
      .update({
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tx.id);

    if (updateError) {
      console.error("[Paystack Webhook] Supabase update failed:", updateError);
      return NextResponse.json(
        { error: "Failed to update transaction." },
        { status: 500 }
      );
    }

    console.log(`[Paystack Webhook] ✓ Transaction ${tx.id} marked completed. Initiating fulfillment.`);

    // 7. Fire-and-forget fulfillment
    const targetNetwork = (tx.network as "base" | "solana") || "base";

    executeCryptoFulfillment(
      tx.id,
      tx.wallet_address,
      Number(tx.crypto_amount),
      targetNetwork
    ).catch((err) => {
      console.error(`[Paystack Webhook] Fulfillment failed for tx ${tx.id}:`, err);
    });

    return NextResponse.json({ success: true, settled_id: tx.id });
  } catch (error) {
    console.error("[Paystack Webhook] Processing error:", error);
    return NextResponse.json(
      { error: "Internal Server Error." },
      { status: 500 }
    );
  }
}
