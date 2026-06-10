"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePrivy } from "@privy-io/react-auth";
import { supabaseBrowser } from "@/lib/supabase-client";
import { Wallet, RefreshCw, Copy, Check } from "lucide-react";

export default function WalletDashboard() {
  const { user } = usePrivy();
  const [balance, setBalance] = useState<string>("0.00");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchBalance = useCallback(async () => {
    if (!user?.wallet?.address) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/wallet/balance?address=${user.wallet.address}`);
      const data = await response.json();

      if (response.ok && data.success) {
        // Format to 2 decimal places for clean UI
        const balNum = Number(data.balance);
        setBalance(isNaN(balNum) ? "0.00" : balNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      } else {
        console.warn("[Dashboard] Failed to fetch balance:", data.error);
      }
    } catch (error) {
      console.error("[Dashboard] Error fetching balance:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.wallet?.address]);

  // Initial fetch when address becomes available
  useEffect(() => {
    if (user?.wallet?.address) {
      fetchBalance();
    }
  }, [user?.wallet?.address, fetchBalance]);

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
          // When a transaction completes or is fulfilled on-chain, trigger a balance refresh
          if (status === "completed" || status === "fulfilled") {
            console.log("[Dashboard] Transaction update detected, refreshing balance...");
            // Wait 2.5 seconds to allow the on-chain txn block to settle and register
            setTimeout(() => {
              fetchBalance();
            }, 2500);
          }
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [user?.id, fetchBalance]);

  const handleCopy = () => {
    if (!user?.wallet?.address) return;
    navigator.clipboard.writeText(user.wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!user || !user.wallet?.address) {
    return null;
  }

  const shortenedAddress = `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`;

  return (
    <Card className="w-full max-w-md mx-auto bg-card/85 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden animate-in fade-in duration-500">
      {/* Decorative neon glow */}
      <div className="absolute -top-12 -left-12 w-24 h-24 bg-primary/20 rounded-full blur-[40px] pointer-events-none" />
      
      <CardContent className="p-5 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Wallet Address & Copy */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/15 rounded-lg flex items-center justify-center border border-primary/20">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
          <div className="text-left">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Connected Wallet</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-sm font-mono font-bold text-white">{shortenedAddress}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-white" onClick={handleCopy}>
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* USDC Balance Info */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block">Balance</span>
            <span className="text-2xl font-bold tracking-tight text-white mt-0.5">
              {balance} <span className="text-primary text-lg font-bold">USDC</span>
            </span>
          </div>
          <Button 
            variant="outline" 
            size="icon" 
            className="h-9 w-9 border-white/10 hover:bg-white/5 text-muted-foreground hover:text-white relative"
            onClick={fetchBalance}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-primary" : ""}`} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
