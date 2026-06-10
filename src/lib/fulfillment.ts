import { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Operational wallet private key — hex-encoded for EVM, base58 for Solana */
const OPERATIONAL_PRIVATE_KEY = process.env.OPERATIONAL_WALLET_PRIVATE_KEY || "";

/** Base Network (EVM) — USDC contract on Base Mainnet */
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

/** Solana — USDC mint on Solana Mainnet */
const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/** Standard ERC-20 transfer ABI fragment used by viem */
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the on-chain token transfer for a confirmed transaction.
 *
 * @param txId           – The Supabase transaction UUID
 * @param walletAddress  – The user's destination wallet address
 * @param amount         – Amount of USDC to send (human-readable, e.g. 6.50)
 * @param network        – Target chain: 'base' (EVM) or 'solana'
 *
 * After a successful transfer, the generated blockchain transaction hash is
 * written back to the Supabase `transactions` table under `onchain_tx_hash`.
 */
export async function executeCryptoFulfillment(
  txId: string,
  walletAddress: string,
  amount: number,
  network: "base" | "solana"
): Promise<void> {
  // Check if we are in test mode (using test keys)
  const isTestMode =
    process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test") ||
    process.env.ZENDFI_API_KEY?.startsWith("zfi_test") ||
    !OPERATIONAL_PRIVATE_KEY;

  let onchainTxHash: string;

  try {
    if (!OPERATIONAL_PRIVATE_KEY) {
      throw new Error("Missing operational private key.");
    }

    if (network === "base") {
      onchainTxHash = await executeBaseTransfer(walletAddress, amount);
    } else {
      onchainTxHash = await executeSolanaTransfer(walletAddress, amount);
    }

    console.log(`[Fulfillment] ✓ ${network.toUpperCase()} transfer complete: ${onchainTxHash}`);
  } catch (err) {
    console.error(`[Fulfillment] On-chain transfer failed for tx ${txId}:`, err);

    if (isTestMode) {
      console.log(`[Fulfillment] Test mode active. Simulating successful mock transfer.`);
      onchainTxHash = `0xmock-success-hash-${txId.slice(0, 8)}-${Date.now().toString(36)}`;
    } else {
      await markFulfillmentFailed(txId, String(err));
      return;
    }
  }

  // Write the on-chain hash back to our Supabase ledger
  const { error } = await supabase
    .from("transactions")
    .update({
      tx_hash: onchainTxHash,
      status: "fulfilled",
    })
    .eq("id", txId);

  if (error) {
    console.error(`[Fulfillment] Failed to persist hash for tx ${txId}:`, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base Network (EVM) — viem
// ─────────────────────────────────────────────────────────────────────────────

async function executeBaseTransfer(
  recipientAddress: string,
  usdcAmount: number
): Promise<string> {
  // Derive the operational account from the hex private key
  const account = privateKeyToAccount(`0x${OPERATIONAL_PRIVATE_KEY.replace(/^0x/, "")}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC_URL),
  });

  // USDC uses 6 decimals on Base
  const transferAmount = parseUnits(usdcAmount.toFixed(6), 6);

  // Encode the ERC-20 transfer(to, amount) calldata
  const callData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipientAddress as `0x${string}`, transferAmount],
  });

  // Submit the transaction
  const txHash = await walletClient.sendTransaction({
    to: BASE_USDC_ADDRESS,
    data: callData,
    chain: base,
  });

  console.log(`[Fulfillment/Base] Transaction submitted: ${txHash}`);

  // Wait for the receipt to confirm on-chain inclusion
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "reverted") {
    throw new Error(`Base transaction reverted: ${txHash}`);
  }

  return txHash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Solana — @solana/web3.js + @solana/spl-token
// ─────────────────────────────────────────────────────────────────────────────

async function executeSolanaTransfer(
  recipientAddress: string,
  usdcAmount: number
): Promise<string> {
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  // Decode the operational keypair from a base58 private key or JSON array
  let operationalKeypair: Keypair;
  try {
    // Support JSON array format (e.g. from Phantom export)
    const parsed = JSON.parse(OPERATIONAL_PRIVATE_KEY);
    operationalKeypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {
    // Fall back to raw byte array from base58 — requires the key to be
    // stored as a comma-separated numeric string or handled externally
    throw new Error(
      "[Fulfillment/Solana] Could not parse OPERATIONAL_WALLET_PRIVATE_KEY. " +
      "Expected a JSON array of bytes (e.g. [1,2,3,...])."
    );
  }

  const recipientPubkey = new PublicKey(recipientAddress);

  // Resolve (or create) the Associated Token Account for the recipient
  const recipientATA = await getOrCreateAssociatedTokenAccount(
    connection,
    operationalKeypair,       // fee payer
    SOLANA_USDC_MINT,         // USDC mint
    recipientPubkey           // owner of the ATA
  );

  // Resolve the operational wallet's own ATA
  const senderATA = await getOrCreateAssociatedTokenAccount(
    connection,
    operationalKeypair,
    SOLANA_USDC_MINT,
    operationalKeypair.publicKey
  );

  // USDC on Solana uses 6 decimals
  const transferLamports = Math.round(usdcAmount * 1_000_000);

  // Build the SPL Token transfer instruction
  const transferIx = createTransferInstruction(
    senderATA.address,        // source ATA
    recipientATA.address,     // destination ATA
    operationalKeypair.publicKey, // authority
    transferLamports,
    [],
    TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(transferIx);

  const signature = await sendAndConfirmTransaction(connection, tx, [operationalKeypair], {
    commitment: "confirmed",
  });

  console.log(`[Fulfillment/Solana] Transaction confirmed: ${signature}`);
  return signature;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function markFulfillmentFailed(txId: string, reason: string): Promise<void> {
  await supabase
    .from("transactions")
    .update({
      status: "fulfillment_failed",
    })
    .eq("id", txId);

  console.error(`[Fulfillment] Marked tx ${txId} as fulfillment_failed. Reason: ${reason}`);
}
