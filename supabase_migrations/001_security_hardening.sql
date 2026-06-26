-- ═══════════════════════════════════════════════════════════════════
-- VeloRamp Security Hardening Migration
-- Run this in Supabase SQL Editor BEFORE deploying code changes.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. USER PROFILES — KYC legal name storage for sender verification
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id TEXT PRIMARY KEY,                          -- Privy DID or user identifier
    legal_name TEXT,                                    -- BVN/NIN verified legal name
    email TEXT,
    phone TEXT,
    daily_limit_ngn NUMERIC(12, 2) DEFAULT 200000.00,  -- Per-user daily ceiling (₦200,000)
    is_blocked BOOLEAN DEFAULT false,                   -- Admin kill-switch
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ───────────────────────────────────────────────────────────────────
-- 2. ADMIN ALERTS — Fraud detection audit log
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    alert_type TEXT NOT NULL,                           -- e.g. 'SENDER_NAME_MISMATCH', 'DAILY_LIMIT_EXCEEDED'
    transaction_id UUID REFERENCES public.transactions(id),
    user_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,                  -- Flexible payload for alert context
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_unresolved
    ON public.admin_alerts (resolved, created_at DESC)
    WHERE resolved = false;

-- ───────────────────────────────────────────────────────────────────
-- 3. TRANSACTIONS TABLE HARDENING
-- ───────────────────────────────────────────────────────────────────

-- 3a. Add frozen_fraud to valid status values + enforce enum constraint
-- (Drop existing constraint first if re-running)
DO $$ BEGIN
    ALTER TABLE public.transactions
        ADD CONSTRAINT chk_transactions_status
        CHECK (status IN ('pending', 'completed', 'fulfilled', 'expired', 'fulfillment_failed', 'frozen_fraud'));
EXCEPTION WHEN duplicate_object THEN
    NULL; -- constraint already exists
END $$;

-- 3b. Enforce positive amounts
DO $$ BEGIN
    ALTER TABLE public.transactions
        ADD CONSTRAINT chk_transactions_positive_amount
        CHECK (ngn_amount > 0);
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- 3c. Unique constraint on provider_reference (prevents duplicate webhook processing)
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_provider_reference_unique
    ON public.transactions (provider_reference)
    WHERE provider_reference IS NOT NULL;

-- 3d. Composite index for daily limit queries (user + date)
CREATE INDEX IF NOT EXISTS idx_transactions_user_daily
    ON public.transactions (user_id, created_at DESC);

-- 3e. Auto-update the updated_at timestamp on row modification
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER trg_transactions_updated_at
        BEFORE UPDATE ON public.transactions
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN
    NULL; -- trigger already exists
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_user_profiles_updated_at
        BEFORE UPDATE ON public.user_profiles
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY — Transactions table
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Allow anon/authenticated users to read only their own transactions
CREATE POLICY IF NOT EXISTS "Users can view own transactions"
    ON public.transactions
    FOR SELECT
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Service role bypasses RLS (our API routes use service role key)
-- This is automatic in Supabase — service_role key always bypasses RLS.

-- ───────────────────────────────────────────────────────────────────
-- 5. SQL FUNCTION — Get daily spent for a user
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_daily_spent(p_user_id TEXT)
RETURNS NUMERIC AS $$
DECLARE
    total NUMERIC;
BEGIN
    SELECT COALESCE(SUM(ngn_amount), 0) INTO total
    FROM public.transactions
    WHERE user_id = p_user_id
      AND status NOT IN ('expired', 'fulfillment_failed')
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
    RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ───────────────────────────────────────────────────────────────────
-- 6. REALTIME — Enable for new tables
-- ───────────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_alerts;
