import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * GET /api/wallet/balance
 *
 * Exposes a secure server-side endpoint to query a user's Base USDC balance
 * using the fast, private Alchemy RPC URL without exposing keys.
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

    // Fetch USDC balance (ERC-20 decimal 6)
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

    const formattedBalance = formatUnits(rawBalance, 6);

    return NextResponse.json({
      success: true,
      address,
      balance: formattedBalance,
    });
  } catch (error) {
    console.error("[Balance API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch USDC balance." },
      { status: 500 }
    );
  }
}
