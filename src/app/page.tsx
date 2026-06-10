import SwapCard from "@/components/SwapCard";
import TransactionHistory from "@/components/TransactionHistory";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center w-full min-h-[calc(100vh-80px)] py-12 px-4 sm:px-6">
      <div className="w-full max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Hero + Swap */}
        <div className="w-full max-w-md mx-auto space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Fund your Web3 Wallet
            </h1>
            <p className="text-lg text-muted-foreground">
              Instantly swap Naira to Crypto directly to your embedded wallet.
            </p>
          </div>
          
          <SwapCard />
        </div>

        {/* Transaction Ledger */}
        <TransactionHistory />
      </div>
    </div>
  );
}

