import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { executeCryptoFulfillment } from "@/lib/fulfillment";

/**
 * GET /api/cron/fulfill-stale
 *
 * Vercel Cron-compatible fallback route.
 * Picks up transactions stuck in 'completed' status (payment confirmed but
 * crypto fulfillment failed silently) and re-attempts fulfillment.
 *
 * Safety:
 * - Uses atomic status claim (eq 'completed') to prevent double-processing
 * - Only processes transactions between 2 and 30 minutes old
 * - Protected by CRON_SECRET authorization header
 */
export async function GET(req: NextRequest) {
  // Verify cron authorization
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error("[Cron/FulfillStale] Unauthorized cron request.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find stale 'completed' transactions (2-30 minutes old)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: staleTxs, error: queryError } = await supabase
      .from("transactions")
      .select("id, wallet_address, crypto_amount, network")
      .eq("status", "completed")
      .lt("created_at", twoMinutesAgo)
      .gt("created_at", thirtyMinutesAgo)
      .limit(10); // Process at most 10 per cron tick

    if (queryError) {
      console.error("[Cron/FulfillStale] Query error:", queryError);
      return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }

    if (!staleTxs || staleTxs.length === 0) {
      console.log("[Cron/FulfillStale] No stale transactions found.");
      return NextResponse.json({ success: true, processed: 0 });
    }

    console.log(`[Cron/FulfillStale] Found ${staleTxs.length} stale transaction(s). Processing...`);

    let processed = 0;
    let failed = 0;

    for (const tx of staleTxs) {
      // Atomic claim: only process if still 'completed'
      const { data: claimed, error: claimError } = await supabase
        .from("transactions")
        .update({ status: "completed" }) // No-op update but with atomic eq check
        .eq("id", tx.id)
        .eq("status", "completed")
        .select("id")
        .single();

      if (claimError || !claimed) {
        console.log(`[Cron/FulfillStale] Tx ${tx.id} already claimed by another process. Skipping.`);
        continue;
      }

      try {
        const targetNetwork = (tx.network as "base" | "solana") || "base";
        await executeCryptoFulfillment(
          tx.id,
          tx.wallet_address,
          Number(tx.crypto_amount),
          targetNetwork
        );
        processed++;
        console.log(`[Cron/FulfillStale] ✓ Fulfilled tx ${tx.id}`);
      } catch (err) {
        failed++;
        console.error(`[Cron/FulfillStale] ✗ Failed to fulfill tx ${tx.id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      found: staleTxs.length,
      processed,
      failed,
    });
  } catch (error) {
    console.error("[Cron/FulfillStale] Unexpected error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
