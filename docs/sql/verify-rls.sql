-- 1. Expected result: zero rows.
-- Any returned application table has RLS disabled and must be fixed before production.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname NOT IN ('_prisma_migrations', 'spatial_ref_sys')
  AND NOT c.relrowsecurity
ORDER BY c.relname;

-- 2. Expected for every row:
-- rls_enabled = true, has_data_api_policy = false, has_data_api_grant = false.
WITH protected_tables(table_name) AS (
  VALUES
    ('AdvisorReport'),
    ('DailyActionLog'),
    ('TelegramPendingAction'),
    ('TelegramPendingWorkRecord'),
    ('WorkRecord'),
    ('MonthlyTaktLevel'),
    ('ThreeYearGoalScenario'),
    ('AnnualGoalRow'),
    ('AnnualGoalPlan'),
    ('CrisisSettings'),
    ('WeeklyHypothesis')
)
SELECT
  protected_tables.table_name,
  COALESCE(pg_class.relrowsecurity, false) AS rls_enabled,
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE pg_policies.schemaname = 'public'
      AND pg_policies.tablename = protected_tables.table_name
      AND pg_policies.roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ) AS has_data_api_policy,
  EXISTS (
    SELECT 1
    FROM pg_roles AS data_api_role
    WHERE data_api_role.rolname IN ('anon', 'authenticated')
      AND (
        has_table_privilege(data_api_role.oid, pg_class.oid, 'SELECT')
        OR has_table_privilege(data_api_role.oid, pg_class.oid, 'INSERT')
        OR has_table_privilege(data_api_role.oid, pg_class.oid, 'UPDATE')
        OR has_table_privilege(data_api_role.oid, pg_class.oid, 'DELETE')
        OR has_table_privilege(data_api_role.oid, pg_class.oid, 'TRUNCATE')
        OR has_table_privilege(data_api_role.oid, pg_class.oid, 'REFERENCES')
        OR has_table_privilege(data_api_role.oid, pg_class.oid, 'TRIGGER')
      )
  ) AS has_data_api_grant
FROM protected_tables
LEFT JOIN pg_namespace
  ON pg_namespace.nspname = 'public'
LEFT JOIN pg_class
  ON pg_class.relnamespace = pg_namespace.oid
 AND pg_class.relname = protected_tables.table_name
ORDER BY protected_tables.table_name;

-- 3. Expected result: zero rows.
-- This stronger check lists any policy exposed to a browser Data API role,
-- even if the policy is ownership-scoped rather than unrestricted.
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'AdvisorReport',
    'DailyActionLog',
    'TelegramPendingAction',
    'TelegramPendingWorkRecord',
    'WorkRecord',
    'MonthlyTaktLevel',
    'ThreeYearGoalScenario',
    'AnnualGoalRow',
    'AnnualGoalPlan',
    'CrisisSettings',
    'WeeklyHypothesis'
  )
  AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
ORDER BY tablename, policyname;
