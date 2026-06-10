"use client";

import React, { useState, useEffect } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

// Debug component that logs Privy state
function PrivyDebugger() {
  const privy = usePrivy();
  
  useEffect(() => {
    console.log("[PrivyDebugger] State update:", {
      ready: privy.ready,
      authenticated: privy.authenticated,
      user: privy.user ? "exists" : "null",
    });
  }, [privy.ready, privy.authenticated, privy.user]);

  useEffect(() => {
    // Log every 2 seconds until ready
    const interval = setInterval(() => {
      if (!privy.ready) {
        console.warn("[PrivyDebugger] Still not ready after interval check. ready:", privy.ready);
      } else {
        console.log("[PrivyDebugger] SDK is ready!");
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [privy.ready]);

  return null;
}

// Error Boundary
class PrivyErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message };
  }

  componentDidCatch(error: Error) {
    console.error("[PrivyErrorBoundary] Fatal:", error.message);
  }

  render() {
    if (this.state.hasError) {
      console.error("[PrivyErrorBoundary] Rendering fallback due to:", this.state.errorMsg);
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[Providers] Mounting with appId:", appId ? `${appId.slice(0, 8)}...` : "MISSING");
  }, [appId]);

  if (!appId || appId.includes("your_privy")) {
    console.warn("[Providers] No valid Privy App ID.");
    return <>{children}</>;
  }

  return (
    <PrivyErrorBoundary fallback={<>{children}</>}>
      <PrivyProvider
        appId={appId}
        config={{
          appearance: {
            theme: "dark",
            accentColor: "#22c55e",
          },
          embeddedWallets: {
            ethereum: {
              createOnLogin: "users-without-wallets",
            },
            solana: {
              createOnLogin: "users-without-wallets",
            },
          },
        }}
      >
        <PrivyDebugger />
        {children}
      </PrivyProvider>
    </PrivyErrorBoundary>
  );
}
