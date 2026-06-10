-- ═══════════════════════════════════════════════════════════════════
-- Naira-to-Crypto On-Ramp — Full Schema (Week 3)
-- Paste this directly into your Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

-- Drop existing table if you want a clean slate (DESTRUCTIVE!)
-- DROP TABLE IF EXISTS public.transactions;

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    ngn_amount NUMERIC(12, 2) NOT NULL,
    crypto_amount NUMERIC(16, 6) NOT NULL,
    rate_applied NUMERIC(12, 2) NOT NULL,
    fee_charged NUMERIC(12, 2) NOT NULL,
    bank_account_assigned TEXT,
    bank_name TEXT,
    network TEXT DEFAULT 'base'::text,
    payment_provider TEXT DEFAULT 'zendfi'::text,
    provider_reference TEXT,
    status TEXT DEFAULT 'pending'::text,
    onchain_tx_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════
-- Migration helper: If your table already exists from an earlier week,
-- run these ALTER statements instead to add the new columns.
-- ═══════════════════════════════════════════════════════════════════

-- ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS network TEXT DEFAULT 'base'::text;
-- ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS onchain_tx_hash TEXT;
-- ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'zendfi'::text;
-- ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS provider_reference TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- Enable Supabase Realtime on this table (required for frontend
-- postgres_changes subscriptions to work)
-- ═══════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;

-- Index for fast user-scoped queries from the Transaction History UI
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions (user_id);

-- Index for fast Paystack webhook lookups by provider_reference
CREATE INDEX IF NOT EXISTS idx_transactions_provider_reference ON public.transactions (provider_reference);

