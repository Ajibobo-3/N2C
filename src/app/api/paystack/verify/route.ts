import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { executeCryptoFulfillment } from "@/lib/fulfillment";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

/**
 * POST /api/paystack/verify
 *
 * Server-side "Trust but Verify" endpoint.
 * After the Paystack popup fires onSuccess on the frontend, we verify
 * the transaction directly with Paystack's API before updating our DB.
 *
 * This prevents malicious frontend manipulation of the success callback.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reference } = body;

    if (!reference) {
      return NextResponse.json(
        { error: "Missing required field: reference" },
        { status: 400 }
      );
    }

    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        { error: "Paystack is not configured on this server." },
        { status: 503 }
      );
    }

    // 1. Verify with Paystack
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const verifyData = await verifyResponse.json();

    if (!verifyResponse.ok || !verifyData.status) {
      console.error("[Paystack Verify] API error:", verifyData);
      return NextResponse.json(
        { error: verifyData.message || "Paystack verification failed." },
        { status: 502 }
      );
    }

    const txStatus = verifyData.data.status; // "success", "abandoned", "failed"

    if (txStatus !== "success") {
      return NextResponse.json(
        { verified: false, paystack_status: txStatus, message: `Payment status: ${txStatus}` },
        { status: 200 }
      );
    }

    // 2. Look up the transaction in our DB by provider_reference
    const { data: tx, error: lookupError } = await supabase
      .from("transactions")
      .select("*")
      .eq("provider_reference", reference)
      .single();

    if (lookupError || !tx) {
      console.error("[Paystack Verify] Transaction not found for reference:", reference);
      return NextResponse.json(
        { error: "Transaction not found for this reference." },
        { status: 404 }
      );
    }

    // 3. Idempotency guard — don't double-process
    if (tx.status === "completed" || tx.status === "fulfilled") {
      return NextResponse.json({
        verified: true,
        already_processed: true,
        transaction_id: tx.id,
      });
    }

    // 4. Mark as completed in Supabase
    const { error: updateError } = await supabase
      .from("transactions")
      .update({
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tx.id);

    if (updateError) {
      console.error("[Paystack Verify] Supabase update failed:", updateError);
      return NextResponse.json(
        { error: "Failed to update transaction status." },
        { status: 500 }
      );
    }

    console.log(`[Paystack Verify] ✓ Transaction ${tx.id} verified & marked completed. Triggering fulfillment.`);

    // 5. Fire-and-forget on-chain fulfillment
    const targetNetwork = (tx.network as "base" | "solana") || "base";

    executeCryptoFulfillment(
      tx.id,
      tx.wallet_address,
      Number(tx.crypto_amount),
      targetNetwork
    ).catch((err) => {
      console.error(`[Paystack Verify] Fulfillment failed for tx ${tx.id}:`, err);
    });

    return NextResponse.json({
      verified: true,
      transaction_id: tx.id,
      message: "Payment verified. USDC fulfillment initiated.",
    });
  } catch (error) {
    console.error("[Paystack Verify] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error during Paystack verification." },
      { status: 500 }
    );
  }
}
