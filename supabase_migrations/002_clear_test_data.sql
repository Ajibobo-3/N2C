-- ═══════════════════════════════════════════════════════════════════
-- VeloRamp Database Reset Script (DESTRUCTIVE!)
-- Safe wrapper checks table existence before truncating.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Clear admin alerts (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_alerts') THEN
        EXECUTE 'TRUNCATE TABLE public.admin_alerts CASCADE';
        RAISE NOTICE '✓ admin_alerts cleared.';
    ELSE
        RAISE NOTICE 'admin_alerts does not exist, skipping.';
    END IF;
END $$;

-- 2. Clear transactions (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transactions') THEN
        EXECUTE 'TRUNCATE TABLE public.transactions CASCADE';
        RAISE NOTICE '✓ transactions cleared.';
    ELSE
        RAISE NOTICE 'transactions does not exist, skipping.';
    END IF;
END $$;

-- 3. Clear user profiles (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_profiles') THEN
        EXECUTE 'TRUNCATE TABLE public.user_profiles CASCADE';
        RAISE NOTICE '✓ user_profiles cleared.';
    ELSE
        RAISE NOTICE 'user_profiles does not exist, skipping.';
    END IF;
END $$;
