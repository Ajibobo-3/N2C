import { useState, useEffect } from 'react';

// MOCK PRIVY SDK
// This bypasses the real Privy SDK to ensure the UI runs smoothly for the sprint demo
// Switch back to "import { usePrivy } from '@privy-io/react-auth';" once the Vercel domains are whitelisted.

let globalAuth = false;
let listeners: any[] = [];

const setGlobalAuth = (val: boolean) => {
  globalAuth = val;
  listeners.forEach(l => l(val));
};

export function usePrivy() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(globalAuth);
  
  useEffect(() => {
    // Sync with global auth state so Navbar and SwapCard share the same session
    const listener = (val: boolean) => setAuthenticated(val);
    listeners.push(listener);
    
    // Simulate SDK loading instantly
    const timer = setTimeout(() => setReady(true), 200);
    return () => {
      clearTimeout(timer);
      listeners = listeners.filter(l => l !== listener);
    };
  }, []);

  const login = () => {
    console.log("[Simulation] Triggering Mock Login Sequence...");
    // Simulate a 1 second connection delay then authenticate
    setTimeout(() => {
      setGlobalAuth(true);
    }, 800);
  };

  const logout = () => {
    console.log("[Simulation] Triggering Mock Logout...");
    setGlobalAuth(false);
  };

  return {
    ready,
    authenticated,
    user: authenticated ? { 
      id: 'did:privy:simulation-mode',
      wallet: { address: '0x8F9aC3d5f1aC9A3bE2dD7a68F2bE3a2f9b8c7D6E' } 
    } : null,
    login,
    logout
  };
}
