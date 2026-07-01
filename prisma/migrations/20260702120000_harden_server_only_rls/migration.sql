-- These tables are accessed only by the Next.js server through Prisma.
-- No browser Data API role needs a policy or table grant.
-- This migration is idempotent and can also be pasted into Supabase SQL Editor.

BEGIN;

ALTER TABLE public."DailyActionLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TelegramPendingAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MonthlyTaktLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ThreeYearGoalScenario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnnualGoalRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnnualGoalPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CrisisSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WeeklyHypothesis" ENABLE ROW LEVEL SECURITY;

-- Remove every stale Data API policy from this exact server-only table set.
-- With RLS enabled and no policies, anon/authenticated requests are denied by default.
DO $security$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'DailyActionLog',
        'TelegramPendingAction',
        'MonthlyTaktLevel',
        'ThreeYearGoalScenario',
        'AnnualGoalRow',
        'AnnualGoalPlan',
        'CrisisSettings',
        'WeeklyHypothesis'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END
$security$;

-- Defense in depth: these tables are not part of the browser-facing Data API surface.
REVOKE ALL PRIVILEGES ON TABLE public."DailyActionLog" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."TelegramPendingAction" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."MonthlyTaktLevel" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."ThreeYearGoalScenario" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."AnnualGoalRow" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."AnnualGoalPlan" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."CrisisSettings" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public."WeeklyHypothesis" FROM PUBLIC;

DO $security$
DECLARE
  data_api_role text;
  protected_table text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      FOREACH protected_table IN ARRAY ARRAY[
        'DailyActionLog',
        'TelegramPendingAction',
        'MonthlyTaktLevel',
        'ThreeYearGoalScenario',
        'AnnualGoalRow',
        'AnnualGoalPlan',
        'CrisisSettings',
        'WeeklyHypothesis'
      ]
      LOOP
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          protected_table,
          data_api_role
        );
      END LOOP;
    END IF;
  END LOOP;
END
$security$;

COMMIT;
