'use client';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black text-zinc-300 px-6 py-12 max-w-3xl mx-auto font-sans">
      <h1 className="text-3xl font-bold text-orange-500 mb-2">Terms of Service</h1>
      <p className="text-sm text-zinc-500 mb-8">Last updated: June 2026</p>
      
      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">1. Nature of Service</h2>
          <p>N2C On-Ramp is a decentralized, non-custodial technology middleware layer. We facilitate the conversion of local fiat payment methods into digital assets using third-party payment processors and self-custodial smart contracts. N2C does not store, hold, or manage user funds or digital assets directly.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">2. Fees and Exchange Rates</h2>
          <p>All exchange rates displayed include a dynamic processing spread (typically 1.8%). By initiating a swap, you explicitly acknowledge and agree to the final token delivery output calculated at checkout. Network transaction (gas) fees are computed automatically and deducted from the execution volume.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">3. Account Integrity & Custom Identity</h2>
          <p>Authentication is completed securely via Privy. You are solely responsible for maintaining the security of your linked authentication methods (e.g., Google account or phone number) which secure access to your embedded, cryptographic self-custodial wallet layout.</p>
        </section>
      </div>
    </div>
  );
}
