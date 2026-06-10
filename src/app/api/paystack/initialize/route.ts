import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_API_URL = "https://api.paystack.co/transaction/initialize";

/**
 * POST /api/paystack/initialize
 *
 * Server-side Paystack transaction initialization.
 * Called by the frontend when the swap API signals `provider: "paystack"`.
 *
 * 1. Validates the transaction exists in Supabase
 * 2. Initialises a Paystack transaction with the correct NGN amount
 * 3. Stores the Paystack reference in our DB for later verification
 * 4. Returns the authorization_url + reference to the frontend
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transaction_id, email } = body;

    if (!transaction_id || !email) {
      return NextResponse.json(
        { error: "Missing required fields (transaction_id, email)" },
        { status: 400 }
      );
    }

    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        { error: "Paystack is not configured on this server." },
        { status: 503 }
      );
    }

    // 1. Look up the pending transaction in Supabase
    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .select("id, ngn_amount, status")
      .eq("id", transaction_id)
      .single();

    if (txError || !tx) {
      return NextResponse.json(
        { error: "Transaction not found." },
        { status: 404 }
      );
    }

    if (tx.status !== "pending") {
      return NextResponse.json(
        { error: `Transaction is already ${tx.status}.` },
        { status: 409 }
      );
    }

    // 2. Initialize on Paystack — amount in kobo (NGN × 100)
    const amountInKobo = Math.round(Number(tx.ngn_amount) * 100);
    const paystackRef = `n2c-${transaction_id}-${Date.now()}`;

    const paystackResponse = await fetch(PAYSTACK_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        reference: paystackRef,
        currency: "NGN",
        metadata: {
          transaction_id,
          custom_fields: [
            {
              display_name: "N2C Transaction",
              variable_name: "n2c_tx_id",
              value: transaction_id,
            },
          ],
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      console.error("[Paystack Init] API error:", paystackData);
      return NextResponse.json(
        { error: paystackData.message || "Failed to initialize Paystack transaction." },
        { status: 502 }
      );
    }

    // 3. Store the Paystack reference back in our DB
    const { error: updateError } = await supabase
      .from("transactions")
      .update({
        provider_reference: paystackRef,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction_id);

    if (updateError) {
      console.error("[Paystack Init] Failed to store reference:", updateError);
    }

    // 4. Return the authorization URL + reference to the frontend
    return NextResponse.json({
      success: true,
      authorization_url: paystackData.data.authorization_url,
      reference: paystackRef,
      access_code: paystackData.data.access_code,
    });
  } catch (error) {
    console.error("[Paystack Init] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error during Paystack initialization." },
      { status: 500 }
    );
  }
}
