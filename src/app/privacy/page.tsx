'use client';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-zinc-300 px-6 py-12 max-w-3xl mx-auto font-sans">
      <h1 className="text-3xl font-bold text-orange-500 mb-2">Privacy Policy</h1>
      <p className="text-sm text-zinc-500 mb-8">Last updated: June 2026</p>
      
      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">1. Information Collection</h2>
          <p>We do not collect personal identifiers, financial data, bank login details, or transaction histories. Identity authentication is managed securely by Privy. Your on-chain transactions are logged immutably on the respective public blockchains (Base or Solana).</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">2. Processing Webhooks</h2>
          <p>Transaction confirmation routing relies entirely on secure, encrypted webhook payloads transmitted between our infrastructure and authorized payment gateways. No consumer financial credentials cross our servers.</p>
        </section>
      </div>
    </div>
  );
}
