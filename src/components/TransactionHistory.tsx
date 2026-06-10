"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, RefreshCw, Receipt } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { supabaseBrowser } from "@/lib/supabase-client";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TransactionRow {
  id: string;
  ngn_amount: number;
  crypto_amount: number;
  network: string | null;
  status: string;
  onchain_tx_hash: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Badge Styling Map
// ─────────────────────────────────────────────────────────────────────────────

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
    case "fulfilled":
      return "default";
    case "pending":
      return "secondary";
    case "expired":
    case "fulfillment_failed":
      return "destructive";
    default:
      return "outline";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
    case "fulfilled":
      return "bg-primary/20 text-primary border-primary/30";
    case "pending":
      return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    case "expired":
    case "fulfillment_failed":
      return "bg-red-500/20 text-red-300 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/**
 * Returns the appropriate block explorer URL for the given network and hash.
 */
function getExplorerUrl(network: string | null, hash: string): string {
  if (network === "solana") {
    return `https://solscan.io/tx/${hash}`;
  }
  // Default to Basescan for EVM / Base network
  return `https://basescan.org/tx/${hash}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function TransactionHistory() {
  const { user } = usePrivy();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTransactions = useCallback(async () => {
    if (!user?.id) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabaseBrowser
        .from("transactions")
        .select("id, ngn_amount, crypto_amount, network, status, onchain_tx_hash, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[History] Supabase query error:", error);
        return;
      }

      setTransactions((data as TransactionRow[]) || []);
    } catch (err) {
      console.error("[History] Fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Initial fetch
  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Real-time subscription for live status updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabaseBrowser
      .channel("history-live")
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to INSERT and UPDATE
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as TransactionRow;

          setTransactions((prev) => {
            const exists = prev.findIndex((t) => t.id === updated.id);
            if (exists >= 0) {
              // Update in-place
              const next = [...prev];
              next[exists] = updated;
              return next;
            }
            // New row — prepend
            return [updated, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [user?.id]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <Card className="w-full max-w-4xl mx-auto bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl">
        <CardContent className="py-16 text-center">
          <Receipt className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground">Connect your wallet to view transaction history.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-4xl mx-auto bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl overflow-hidden relative">
      {/* Decorative glow */}
      <div className="absolute -top-32 -right-32 w-64 h-64 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />

      <CardHeader className="relative z-10 flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-xl font-bold bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
            Transaction Ledger
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Your complete on-ramp history — powered by real-time sync.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-white"
          onClick={fetchTransactions}
          disabled={isLoading}
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="relative z-10 p-0">
        {isLoading && transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary/60" />
            <span className="text-sm text-muted-foreground">Loading transactions...</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Receipt className="w-12 h-12 text-muted-foreground/40" />
            <span className="text-sm text-muted-foreground">No transactions yet. Make your first swap!</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">Date/Time</TableHead>
                  <TableHead className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">Naira Sent</TableHead>
                  <TableHead className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">Crypto Payout</TableHead>
                  <TableHead className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">Network</TableHead>
                  <TableHead className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-muted-foreground font-semibold text-xs uppercase tracking-wider text-right">Explorer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow
                    key={tx.id}
                    className="border-white/5 hover:bg-white/[0.03] transition-colors"
                  >
                    {/* Date/Time */}
                    <TableCell className="font-medium text-sm text-slate-200">
                      <div className="flex flex-col">
                        <span>{new Date(tx.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </TableCell>

                    {/* Naira Sent */}
                    <TableCell className="font-mono text-sm text-slate-200">
                      ₦{Number(tx.ngn_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>

                    {/* Crypto Payout */}
                    <TableCell className="font-mono text-sm text-primary">
                      {Number(tx.crypto_amount).toFixed(2)} USDC
                    </TableCell>

                    {/* Network */}
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize border-white/10 text-slate-300">
                        {tx.network || "base"}
                      </Badge>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge
                        variant={statusVariant(tx.status)}
                        className={`text-xs capitalize ${statusColor(tx.status)}`}
                      >
                        {tx.status === "fulfillment_failed" ? "Failed" : tx.status}
                      </Badge>
                    </TableCell>

                    {/* Explorer Link */}
                    <TableCell className="text-right">
                      {tx.onchain_tx_hash ? (
                        <a
                          href={getExplorerUrl(tx.network, tx.onchain_tx_hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary/80 hover:text-primary transition-colors"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
