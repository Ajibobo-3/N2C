import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Configuration Constants
const MOCK_BASE_RATE = 1500; // 1 USDC = 1500 NGN
const SPREAD_PERCENTAGE = 0.018; // 1.8% convenience spread
const ZENDFI_API_URL = process.env.ZENDFI_API_URL || "https://api.zendfi.tech/api/v1/payment-links";
const ZENDFI_API_KEY = process.env.ZENDFI_API_KEY || "";

/**
 * POST /api/swap
 * Secure Quote & Account Generation Service
 * 
 * Receives swap details from the frontend, calculates the convenience spread,
 * provisions a dynamic virtual bank account via ZendFi infrastructure API,
 * and tracks the pending transaction in Supabase.
 *
 * If ZendFi fails (misconfigured, down, invalid key), the API returns a
 * `provider: "paystack"` signal so the frontend can fall back to Paystack
 * inline checkout instead of showing a useless fake bank account.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_id, wallet_address, ngn_amount } = body;

    // 1. Input Validation
    if (!user_id || !wallet_address || !ngn_amount || isNaN(Number(ngn_amount))) {
      return NextResponse.json(
        { error: "Missing or invalid required fields (user_id, wallet_address, ngn_amount)" },
        { status: 400 }
      );
    }

    const inputAmount = Number(ngn_amount);
    
    // 2. Programmatic Spread & Crypto Payout Calculation
    // We apply our 1.8% convenience fee to the raw NGN input.
    const feeCharged = inputAmount * SPREAD_PERCENTAGE;
    const effectiveNgn = inputAmount - feeCharged;
    const cryptoPayout = effectiveNgn / MOCK_BASE_RATE;

    if (cryptoPayout <= 0) {
      return NextResponse.json(
        { error: "Amount too low after fees." },
        { status: 400 }
      );
    }

    // 3. Try ZendFi first — provision a dynamic virtual bank account
    let zendfiSuccess = false;
    let providerData: { data: { account_number: string; bank_name: string; account_name: string } } | null = null;

    if (ZENDFI_API_KEY && ZENDFI_API_KEY !== "your_zendfi_api_key_here") {
      try {
        const zendfiResponse = await fetch(ZENDFI_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${ZENDFI_API_KEY}`
          },
          body: JSON.stringify({
            amount: inputAmount,
            currency: "NGN",
            onramp: true,
            reference: `tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          })
        });

        if (zendfiResponse.ok) {
          providerData = await zendfiResponse.json();
          zendfiSuccess = true;
        } else {
          console.warn("[Swap] ZendFi API returned non-OK status:", zendfiResponse.status);
        }
      } catch (err) {
        console.warn("[Swap] ZendFi API call failed:", err);
      }
    } else {
      console.warn("[Swap] ZendFi API key not configured — falling back to Paystack.");
    }

    // 4. Determine provider and insert into Supabase
    const paymentProvider = zendfiSuccess ? "zendfi" : "paystack";

    const insertPayload: Record<string, unknown> = {
      user_id,
      wallet_address,
      ngn_amount: inputAmount,
      crypto_amount: Number(cryptoPayout.toFixed(6)),
      rate_applied: MOCK_BASE_RATE,
      fee_charged: Number(feeCharged.toFixed(2)),
      payment_provider: paymentProvider,
      status: "pending",
    };

    // Only set bank details if ZendFi succeeded
    if (zendfiSuccess && providerData) {
      insertPayload.bank_account_assigned = providerData.data.account_number;
      insertPayload.bank_name = providerData.data.bank_name;
    }

    const { data: txRecord, error: dbError } = await supabase
      .from("transactions")
      .insert([insertPayload])
      .select()
      .single();

    if (dbError) {
      console.error("[Swap] Supabase Insertion Error:", dbError);
      return NextResponse.json(
        { error: "Failed to persist transaction record." },
        { status: 500 }
      );
    }

    // 5. Return response — shape depends on provider
    if (zendfiSuccess && providerData) {
      // ZendFi flow — frontend shows virtual bank account UI
      return NextResponse.json({
        success: true,
        provider: "zendfi",
        transaction_id: txRecord.id,
        bank_name: txRecord.bank_name,
        account_number: txRecord.bank_account_assigned,
        account_name: providerData.data.account_name || "N2C Virtual Acct",
        crypto_payout: txRecord.crypto_amount,
        fee_charged: txRecord.fee_charged,
      });
    } else {
      // Paystack fallback — frontend shows "Pay with Paystack" button
      return NextResponse.json({
        success: true,
        provider: "paystack",
        transaction_id: txRecord.id,
        crypto_payout: txRecord.crypto_amount,
        fee_charged: txRecord.fee_charged,
      });
    }

  } catch (error) {
    console.error("[Swap] API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error during quote generation." },
      { status: 500 }
    );
  }
}
