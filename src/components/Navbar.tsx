'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePrivy, useExportWallet } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function Navbar() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { exportWallet } = useExportWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Log Privy state changes for debugging
  useEffect(() => {
    console.log("[Navbar] Privy state:", { ready, authenticated, hasUser: !!user });
  }, [ready, authenticated, user]);

  const formatAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleConnect = useCallback(() => {
    console.log("[Navbar] Connect Wallet clicked. ready:", ready, "authenticated:", authenticated);
    try {
      login();
    } catch (err) {
      console.error("[Navbar] login() threw:", err);
    }
  }, [ready, authenticated, login]);

  const handleDisconnect = useCallback(() => {
    console.log("[Navbar] Disconnect clicked");
    logout();
  }, [logout]);

  // Don't render anything interactive until client-side mounted
  if (!mounted) {
    return (
      <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-black">
        <div className="flex items-center gap-3">
          <div className="text-xl font-bold tracking-wider text-orange-500">N2C On-Ramp</div>
          {/* Live Trust Status Node */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-800 text-[10px] text-emerald-400 font-medium tracking-wide uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Systems Operational
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a 
            href="mailto:support@n2c-app.com"
            className="text-xs text-zinc-400 hover:text-white border border-zinc-800 rounded-md px-2.5 py-1.5 transition-colors bg-zinc-950/40 font-medium"
          >
            Contact Support (Email)
          </a>
          <Button disabled className="bg-zinc-900 border-zinc-800 text-zinc-500 w-[160px]">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Loading...
          </Button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-black">
      <div className="flex items-center gap-3">
        <div className="text-xl font-bold tracking-wider text-orange-500">N2C On-Ramp</div>
        {/* Live Trust Status Node */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-800 text-[10px] text-emerald-400 font-medium tracking-wide uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Systems Operational
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <a 
          href="mailto:support@n2c-app.com"
          className="text-xs text-zinc-400 hover:text-white border border-zinc-800 rounded-md px-2.5 py-1.5 transition-colors bg-zinc-950/40 font-medium"
        >
          Contact Support (Email)
        </a>

        {ready && authenticated && (
          <button
            onClick={exportWallet}
            className="text-xs text-orange-500/90 hover:text-orange-400 border border-orange-950 bg-orange-950/20 rounded-md px-2.5 py-1.5 transition-colors font-semibold"
          >
            🛡️ Export Private Key
          </button>
        )}

        {!ready ? (
          <Button disabled className="bg-zinc-900 border-zinc-800 text-zinc-500 w-[160px]">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Connecting...
          </Button>
        ) : authenticated && user?.wallet?.address ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400 font-mono bg-zinc-900 px-3 py-1.5 rounded-md border border-zinc-800">
              {formatAddress(user.wallet.address)}
            </span>
            <Button 
              onClick={handleDisconnect}
              variant="outline"
              className="border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all duration-200"
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button 
            onClick={handleConnect}
            className="bg-green-500 text-black hover:bg-green-600 font-semibold shadow-[0_0_15px_rgba(34,197,94,0.2)] hover:shadow-[0_0_25px_rgba(34,197,94,0.4)] transition-all duration-300"
          >
            Connect Wallet
          </Button>
        )}
      </div>
    </nav>
  );
}
