"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowDownUp, Loader2, Wallet, Clock, Building, ArrowRight, CheckCircle2, AlertTriangle, CreditCard, ShieldCheck } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { supabaseBrowser } from "@/lib/supabase-client";

// Mock Market Configuration for local preview (backend is the source of truth)
const MOCK_BASE_RATE = 1500; // 1 USDC = 1500 NGN
const SPREAD_PERCENTAGE = 0.018; // 1.8% convenience spread

interface TransactionState {
  txId: string | null;
  isPending: boolean;
  virtualAccount: string | null;
  bankName: string | null;
  expiresAt: Date | null;
  status: "pending" | "completed" | "expired" | null;
  provider: "zendfi" | "paystack" | null;
}

export default function SwapCard() {
  const { user } = usePrivy();
  const [ngnAmount, setNgnAmount] = useState<string>("");
  const [cryptoAmount, setCryptoAmount] = useState<string>("");
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [isSwapping, setIsSwapping] = useState<boolean>(false);
  const [isInitializingPaystack, setIsInitializingPaystack] = useState<boolean>(false);
  
  const [transaction, setTransaction] = useState<TransactionState>({
    txId: null,
    isPending: false,
    virtualAccount: null,
    bankName: null,
    expiresAt: null,
    status: null,
    provider: null,
  });
  
  const [countdown, setCountdown] = useState<string>("15:00");

  // ─────────────────────────────────────────────────────────────────
  // Load Paystack inline script
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined" && !document.getElementById("paystack-script")) {
      const script = document.createElement("script");
      script.id = "paystack-script";
      script.src = "https://js.paystack.co/v2/inline.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Exchange Calculation Logic (Local Preview)
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ngnAmount || isNaN(Number(ngnAmount))) {
      setCryptoAmount("");
      setIsCalculating(false);
      return;
    }

    setIsCalculating(true);
    
    // Simulate network latency for rate fetching preview
    const timer = setTimeout(() => {
      const inputAmount = Number(ngnAmount);
      const feeCharged = inputAmount * SPREAD_PERCENTAGE;
      const effectiveNgn = inputAmount - feeCharged;
      const payout = effectiveNgn / MOCK_BASE_RATE;
      
      setCryptoAmount(payout > 0 ? payout.toFixed(2) : "0.00");
      setIsCalculating(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [ngnAmount]);

  // ─────────────────────────────────────────────────────────────────
  // Real-time Supabase Subscription
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!transaction.txId || transaction.status !== "pending") return;

    const channel = supabaseBrowser
      .channel(`tx-updates-${transaction.txId}`)
      .on(
        'postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `id=eq.${transaction.txId}` }, 
        (payload) => {
          if (payload.new.status === 'completed') {
            setTransaction(prev => ({ ...prev, status: 'completed', isPending: false }));
          }
        }
      )
      .subscribe();

    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [transaction.txId, transaction.status]);

  // ─────────────────────────────────────────────────────────────────
  // Checkout Countdown Timer
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (transaction.status !== "pending" || !transaction.expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diff = transaction.expiresAt!.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("00:00");
        clearInterval(interval);
        // Transition to graceful fallback viewport
        setTransaction(prev => ({ ...prev, status: 'expired', isPending: false }));
      } else {
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        setCountdown(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [transaction.status, transaction.expiresAt]);

  // ─────────────────────────────────────────────────────────────────
  // Swap Handler — calls /api/swap, routes to ZendFi or Paystack
  // ─────────────────────────────────────────────────────────────────
  const handleSwap = async () => {
    if (!ngnAmount || Number(ngnAmount) <= 0) return;
    if (!user || !user.wallet?.address) {
      alert("Please connect your wallet first.");
      return;
    }
    
    setIsSwapping(true);
    
    try {
      const response = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          wallet_address: user.wallet.address,
          ngn_amount: Number(ngnAmount),
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate quote.");
      }

      const expires = new Date();
      expires.setMinutes(expires.getMinutes() + 15);

      if (data.provider === "zendfi") {
        // ZendFi flow — show virtual bank account
        setTransaction({
          txId: data.transaction_id,
          isPending: true,
          virtualAccount: data.account_number,
          bankName: data.bank_name,
          expiresAt: expires,
          status: "pending",
          provider: "zendfi",
        });
      } else {
        // Paystack fallback — show "Pay with Paystack" UI
        setTransaction({
          txId: data.transaction_id,
          isPending: true,
          virtualAccount: null,
          bankName: null,
          expiresAt: expires,
          status: "pending",
          provider: "paystack",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      alert(`Error: ${message}`);
    } finally {
      setIsSwapping(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // Paystack Popup Handler
  // ─────────────────────────────────────────────────────────────────
  const handlePaystackPay = useCallback(async () => {
    if (!transaction.txId || !user) return;

    setIsInitializingPaystack(true);

    try {
      // 1. Initialize transaction on our server
      const initResponse = await fetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: transaction.txId,
          email: user.email?.address || user.google?.email || `${user.id.replace(/[^a-zA-Z0-9]/g, '-')}@n2c.app`,
        }),
      });

      const initData = await initResponse.json();

      if (!initResponse.ok) {
        throw new Error(initData.error || "Failed to initialize Paystack.");
      }

      // 2. Open Paystack popup using the inline script
      interface PaystackPopInstance {
        resumeTransaction: (
          accessCode: string,
          options: {
            onSuccess?: (transaction: { reference: string }) => void | Promise<void>;
            onCancel?: () => void;
          }
        ) => void;
      }
      
      const PaystackPopConstructor = (window as unknown as { PaystackPop?: new () => PaystackPopInstance }).PaystackPop;
      
      if (!PaystackPopConstructor) {
        // Fallback: redirect to authorization URL
        window.location.href = initData.authorization_url;
        return;
      }

      const popup = new PaystackPopConstructor();
      popup.resumeTransaction(initData.access_code, {
        onCancel: () => {
          console.log("[Paystack] Popup closed by user.");
          setIsInitializingPaystack(false);
        },
        onSuccess: async (response: { reference: string }) => {
          console.log("[Paystack] Payment callback:", response.reference);
          setIsInitializingPaystack(false);

          // 3. Server-side verification — "Trust but Verify"
          try {
            const verifyResponse = await fetch("/api/paystack/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reference: response.reference }),
            });

            const verifyData = await verifyResponse.json();

            if (verifyData.verified) {
              setTransaction(prev => ({ ...prev, status: "completed", isPending: false }));
            } else {
              console.warn("[Paystack] Verification returned non-verified:", verifyData);
              // The webhook will catch this as a safety net
            }
          } catch (err) {
            console.error("[Paystack] Verify call failed:", err);
            // Don't panic — the webhook handler will still catch successful payments
          }
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      alert(`Paystack Error: ${message}`);
      setIsInitializingPaystack(false);
    }
  }, [transaction.txId, user, ngnAmount]);

  // ─────────────────────────────────────────────────────────────────
  // Reset Handler
  // ─────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setTransaction({
      txId: null,
      isPending: false,
      virtualAccount: null,
      bankName: null,
      expiresAt: null,
      status: null,
      provider: null,
    });
    setNgnAmount("");
    setCryptoAmount("");
  };

  // ─────────────────────────────────────────────────────────────────
  // Render Logic
  // ─────────────────────────────────────────────────────────────────
  const renderContent = () => {
    // ── Success State ──────────────────────────────────────────────
    if (transaction.status === "completed") {
      return (
        <div className="space-y-5 animate-in fade-in zoom-in-95 duration-500 text-center py-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white">Payment Successful!</h2>
          <p className="text-muted-foreground text-sm">
            Your transaction has been verified. The USDC is being dropped into your embedded wallet.
          </p>
          <Button className="w-full mt-4" onClick={handleReset}>
            Start New Swap
          </Button>
        </div>
      );
    }

    // ── Expired State ──────────────────────────────────────────────
    if (transaction.status === "expired") {
      return (
        <div className="space-y-5 animate-in fade-in zoom-in-95 duration-500 text-center py-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-orange-500/20 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-orange-500" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-white">Under Review / Support</h2>
          <p className="text-muted-foreground text-sm px-4">
            The 15-minute runtime threshold has expired. If you already sent the funds, please don't worry. Your transfer is under review by our escalation team and will be credited shortly.
          </p>
          <Button variant="outline" className="w-full mt-4" onClick={handleReset}>
            Return Home
          </Button>
        </div>
      );
    }

    // ── Pending: ZendFi Virtual Account ────────────────────────────
    if (transaction.status === "pending" && transaction.provider === "zendfi") {
      return (
        <div className="space-y-5 animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-5 flex flex-col items-center justify-center space-y-2 relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/5 animate-pulse" />
            <span className="text-sm text-primary/80 font-medium flex items-center gap-1 relative z-10">
              <Clock className="w-4 h-4" /> Expires in {countdown}
            </span>
            <span className="text-3xl font-bold tracking-tight text-white relative z-10">
              ₦{Number(ngnAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </span>
            <span className="text-xs text-muted-foreground relative z-10 mt-1">
              Awaiting network confirmation...
            </span>
          </div>
          
          <div className="space-y-3 bg-background/50 p-4 rounded-xl border border-white/5">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Bank Name</span>
              <span className="text-base font-medium flex items-center gap-2">
                <Building className="w-4 h-4 text-primary" /> {transaction.bankName}
              </span>
            </div>
            <div className="h-px w-full bg-white/5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Virtual Account Number</span>
              <div className="flex justify-between items-center">
                <span className="text-xl font-mono font-bold tracking-widest text-primary">{transaction.virtualAccount}</span>
                <Button variant="ghost" size="sm" className="h-8 text-xs hover:text-primary">
                  Copy
                </Button>
              </div>
            </div>
          </div>
          
          <div className="bg-orange-500/10 border border-orange-500/20 text-orange-200/90 p-3 rounded-lg text-xs leading-relaxed">
            <strong>Notice:</strong> Please transfer exactly the amount shown above. Transfers of a different amount will not be processed automatically.
          </div>

          <div className="flex flex-col w-full gap-3 pt-4">
            <Button 
              className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 relative overflow-hidden group"
              onClick={() => {
                // UX reassurance button
                alert("We are actively listening for the webhook on our backend. The UI will automatically update when the payment clears.");
              }}
            >
              <Loader2 className="w-5 h-5 animate-spin absolute left-4" />
              I have sent the money
            </Button>
            <Button 
              variant="ghost" 
              className="w-full text-muted-foreground hover:text-white"
              onClick={handleReset}
            >
              Cancel Transfer
            </Button>
          </div>
        </div>
      );
    }

    // ── Pending: Paystack Checkout ──────────────────────────────────
    if (transaction.status === "pending" && transaction.provider === "paystack") {
      return (
        <div className="space-y-5 animate-in fade-in zoom-in-95 duration-300">
          {/* Amount Summary */}
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-5 flex flex-col items-center justify-center space-y-2 relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/5 animate-pulse" />
            <span className="text-sm text-primary/80 font-medium flex items-center gap-1 relative z-10">
              <Clock className="w-4 h-4" /> Expires in {countdown}
            </span>
            <span className="text-3xl font-bold tracking-tight text-white relative z-10">
              ₦{Number(ngnAmount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </span>
            <span className="text-xs text-muted-foreground relative z-10 mt-1">
              Complete payment via Paystack
            </span>
          </div>

          {/* Paystack Info Card */}
          <div className="space-y-3 bg-background/50 p-5 rounded-xl border border-white/5 text-center">
            <div className="flex justify-center">
              <div className="w-14 h-14 bg-[#00C3F7]/10 rounded-full flex items-center justify-center">
                <CreditCard className="w-7 h-7 text-[#00C3F7]" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Pay securely using your <strong className="text-white">debit card</strong>, <strong className="text-white">bank transfer</strong>, or <strong className="text-white">USSD</strong>. 
              A secure Paystack checkout will open.
            </p>
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Secured by Paystack — PCI DSS Certified</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col w-full gap-3 pt-2">
            <Button 
              className="w-full h-12 text-base font-bold bg-[#00C3F7] hover:bg-[#00A8D6] text-white shadow-lg shadow-[#00C3F7]/25 transition-all relative overflow-hidden group"
              onClick={handlePaystackPay}
              disabled={isInitializingPaystack}
            >
              {isInitializingPaystack ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CreditCard className="w-5 h-5 mr-2" />
                  Pay with Paystack
                </>
              )}
            </Button>
            <Button 
              variant="ghost" 
              className="w-full text-muted-foreground hover:text-white"
              onClick={handleReset}
              disabled={isInitializingPaystack}
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    // ── Default State: Amount Input ────────────────────────────────
    return (
      <div className="space-y-4">
        {/* You Pay (NGN) */}
        <div className="space-y-2 bg-background/50 p-4 rounded-xl border border-white/5 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground font-medium">You Pay</span>
            <span className="text-xs text-muted-foreground">Max: ₦1,000,000</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-slate-300">₦</span>
            <Input
              type="number"
              placeholder="0.00"
              value={ngnAmount}
              onChange={(e) => setNgnAmount(e.target.value)}
              className="text-2xl font-bold bg-transparent border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/30 h-10"
            />
            <div className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-md">
              <span className="text-sm font-bold">NGN</span>
            </div>
          </div>
        </div>

        {/* Swap Divider */}
        <div className="flex justify-center -my-2 relative z-10">
          <div className="bg-background border border-white/10 rounded-full p-2 text-muted-foreground">
            <ArrowDownUp className="w-4 h-4" />
          </div>
        </div>

        {/* You Receive (USDC) */}
        <div className="space-y-2 bg-background/50 p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground font-medium">You Receive</span>
          </div>
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary/70" />
            {isCalculating ? (
              <div className="flex-1 h-10 flex items-center">
                <div className="h-6 w-24 bg-white/10 animate-pulse rounded-md" />
              </div>
            ) : (
              <Input
                type="text"
                readOnly
                placeholder="0.00"
                value={cryptoAmount}
                className="text-2xl font-bold bg-transparent border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/30 h-10"
              />
            )}
            <div className="flex items-center gap-1 bg-primary/20 text-primary px-2 py-1 rounded-md">
              <span className="text-sm font-bold">USDC</span>
            </div>
          </div>
        </div>
        
        {/* Exchange Details */}
        {Number(ngnAmount) > 0 && (
          <div className="text-xs text-muted-foreground space-y-1.5 px-1 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between">
              <span>Exchange Rate</span>
              <span>$1 = ₦{MOCK_BASE_RATE.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Network Spread (1.8%)</span>
              <span>₦{(Number(ngnAmount) * SPREAD_PERCENTAGE).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button 
            className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 transition-all"
            onClick={handleSwap}
            disabled={!ngnAmount || Number(ngnAmount) <= 0 || isCalculating || isSwapping}
          >
            {isSwapping ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>Swap Instantly <ArrowRight className="w-4 h-4 ml-2" /></>
            )}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full max-w-md mx-auto bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl overflow-hidden relative">
      {/* Decorative neon glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />
      
      <CardHeader className="relative z-10 pb-4">
        <CardTitle className="text-2xl font-bold bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
          {!transaction.status ? "N2C On-Ramp" 
            : transaction.status === "completed" ? "Swap Complete" 
            : transaction.status === "expired" ? "Time Expired"
            : transaction.provider === "paystack" ? "Pay with Paystack"
            : "Complete Payment"}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {!transaction.status 
            ? "Instantly fund your wallet with local bank transfer." 
            : transaction.status === "completed" ? "Your funds have been deposited successfully."
            : transaction.status === "expired" ? "Action required on your transfer."
            : transaction.provider === "paystack" ? "Complete your payment securely via Paystack."
            : "Transfer funds to the virtual account below."}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative z-10">
        {renderContent()}
      </CardContent>
    </Card>
  );
}
