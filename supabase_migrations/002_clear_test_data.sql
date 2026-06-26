-- ═══════════════════════════════════════════════════════════════════
-- VeloRamp Database Reset Script (DESTRUCTIVE!)
-- Run this in Supabase SQL Editor to clear all past transactions,
-- admin alerts, and user profiles to start testing with a clean slate.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Clear admin alerts (referencing transactions)
TRUNCATE TABLE public.admin_alerts CASCADE;

-- 2. Clear transactions
TRUNCATE TABLE public.transactions CASCADE;

-- 3. Clear user profiles
TRUNCATE TABLE public.user_profiles CASCADE;
