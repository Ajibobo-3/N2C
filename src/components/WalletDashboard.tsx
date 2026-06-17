"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { supabaseBrowser } from "@/lib/supabase-client";
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { base } from "viem/chains";
import { Wallet, RefreshCw, Copy, Check } from "lucide-react";

// Standard ERC-20 Minimal ABI for fetching USDC balances
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
] as const;

// Official Base Mainnet USDC contract
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";

// Create a singleton public client for Base Mainnet
const baseClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export default function WalletDashboard() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const [ethBalance, setEthBalance] = useState<string>("0.0000");
  const [usdcBalance, setUsdcBalance] = useState<string>("0.00");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Isolate the user's embedded Privy wallet
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address || user?.wallet?.address;

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) return;

    setIsLoading(true);
    try {
      const addr = walletAddress as `0x${string}`;

      // Fetch both balances in parallel
      const [rawEth, rawUsdc] = await Promise.all([
        baseClient.getBalance({ address: addr }),
        baseClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        }),
      ]);

      setEthBalance(parseFloat(formatEther(rawEth)).toFixed(4));
      setUsdcBalance(
        parseFloat(formatUnits(rawUsdc as bigint, 6)).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      );
    } catch (error) {
      console.error("[Dashboard] Failed to fetch on-chain balances:", error);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  // Initial fetch when address becomes available
  useEffect(() => {
    if (walletAddress) {
      fetchBalances();
    }
  }, [walletAddress, fetchBalances]);

  // Real-time subscription to trigger balance refresh when a transaction finishes
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabaseBrowser
      .channel("dashboard-balance-sync")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const status = payload.new?.status;
          if (status === "completed" || status === "fulfilled") {
            console.log(
              "[Dashboard] Transaction update detected, refreshing balances..."
            );
            // Wait 2.5 seconds for on-chain block confirmation
            setTimeout(() => {
              fetchBalances();
            }, 2500);
          }
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [user?.id, fetchBalances]);

  const handleCopy = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!user || !walletAddress) {
    return null;
  }

  const shortenedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  return (
    <Card className="w-full max-w-md mx-auto bg-card/85 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden animate-in fade-in duration-500">
      {/* Decorative neon glow */}
      <div className="absolute -top-12 -left-12 w-24 h-24 bg-primary/20 rounded-full blur-[40px] pointer-events-none" />

      <CardContent className="p-5 space-y-4">
        {/* Wallet Address & Copy */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/15 rounded-lg flex items-center justify-center border border-primary/20">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <div className="text-left">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Connected Wallet
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-sm font-mono font-bold text-white">
                  {shortenedAddress}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-white"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 border-white/10 hover:bg-white/5 text-muted-foreground hover:text-white relative"
            onClick={fetchBalances}
            disabled={isLoading}
          >
            <RefreshCw
              className={`w-4 h-4 ${isLoading ? "animate-spin text-primary" : ""}`}
            />
          </Button>
        </div>

        {/* Asset Vault Header */}
        <h3 className="text-[11px] font-semibold text-zinc-500 tracking-widest uppercase border-t border-white/5 pt-3">
          Your Secure Asset Vault
        </h3>

        {isLoading ? (
          <div className="text-xs text-zinc-500 animate-pulse py-2">
            Querying blockchain ledgers...
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* USDC Balance Card */}
            <div className="flex items-center justify-between p-3.5 bg-zinc-900/50 border border-zinc-800/60 rounded-lg hover:border-zinc-700/60 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                  <span className="text-xs font-bold text-blue-400">$</span>
                </div>
                <div>
                  <span className="font-medium text-white text-sm block leading-tight">
                    USD Coin
                  </span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    USDC · Base
                  </span>
                </div>
              </div>
              <span className="text-base font-bold text-white tracking-tight">
                {usdcBalance}{" "}
                <span className="text-xs font-normal text-zinc-500">USDC</span>
              </span>
            </div>

            {/* Native ETH Balance Card */}
            <div className="flex items-center justify-between p-3.5 bg-zinc-900/50 border border-zinc-800/60 rounded-lg hover:border-zinc-700/60 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                  <span className="text-xs font-bold text-indigo-400">Ξ</span>
                </div>
                <div>
                  <span className="font-medium text-white text-sm block leading-tight">
                    Ethereum
                  </span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    ETH · Base
                  </span>
                </div>
              </div>
              <span className="text-base font-bold text-white tracking-tight">
                {ethBalance}{" "}
                <span className="text-xs font-normal text-zinc-500">ETH</span>
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
