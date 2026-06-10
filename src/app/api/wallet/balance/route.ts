import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { supabase } from "@/lib/supabase";

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * GET /api/wallet/balance
 *
 * Exposes a secure server-side endpoint to query a user's Base USDC balance.
 * In test mode (test keys configured), it adds the sum of all simulated/mock
 * transactions in the DB to the real on-chain balance, allowing end-to-end
 * testing with updating balances.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");

    if (!address) {
      return NextResponse.json(
        { error: "Missing required query parameter: address" },
        { status: 400 }
      );
    }

    // Initialize public client with server-side RPC
    const client = createPublicClient({
      chain: base,
      transport: http(BASE_RPC_URL),
    });

    // 1. Fetch real USDC balance (ERC-20 decimal 6)
    let realBalance = 0;
    try {
      const rawBalance = await client.readContract({
        address: BASE_USDC_ADDRESS as `0x${string}`,
        abi: [
          {
            name: "balanceOf",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "balance", type: "uint256" }],
          },
        ],
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      realBalance = Number(formatUnits(rawBalance, 6));
    } catch (contractErr) {
      console.warn("[Balance API] Contract read failed (wallet might be empty or RPC rate-limited):", contractErr);
    }

    // 2. Check if we are in test mode (using test keys)
    const isTestMode = 
      process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test") ||
      process.env.ZENDFI_API_KEY?.startsWith("zfi_test");

    let virtualBalance = realBalance;

    if (isTestMode) {
      // Fetch all fulfilled transactions with mock hashes for this wallet address
      const { data: mockTxs, error: dbError } = await supabase
        .from("transactions")
        .select("crypto_amount")
        .eq("wallet_address", address)
        .eq("status", "fulfilled")
        .like("tx_hash", "0xmock-success-hash-%");

      if (!dbError && mockTxs) {
        const mockSum = mockTxs.reduce((sum, tx) => sum + Number(tx.crypto_amount || 0), 0);
        virtualBalance += mockSum;
        console.log(`[Balance API] Address ${address} real balance: ${realBalance} USDC. Mock swaps sum: ${mockSum} USDC. Virtual balance: ${virtualBalance} USDC.`);
      } else if (dbError) {
        console.error("[Balance API] DB Error fetching mock txs:", dbError);
      }
    }

    return NextResponse.json({
      success: true,
      address,
      balance: virtualBalance.toFixed(6),
      is_test_mode: isTestMode,
    });
  } catch (error) {
    console.error("[Balance API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch USDC balance." },
      { status: 500 }
    );
  }
}
