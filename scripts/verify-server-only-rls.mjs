import { PrismaClient } from "@prisma/client";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const tables = [
  "AdvisorReport",
  "DailyActionLog",
  "JournalEntry",
  "LifeContext",
  "TelegramPendingAction",
  "TelegramPendingJournal",
  "TelegramPendingWorkRecord",
  "WeeklyDeliverySettings",
  "WorkRecord",
  "MonthlyTaktLevel",
  "ThreeYearGoalScenario",
  "AnnualGoalRow",
  "AnnualGoalPlan",
  "CrisisSettings",
  "WeeklyHypothesis"
];

try {
  const quoted = tables.map((table) => `'${table.replaceAll("'", "''")}'`).join(",");
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      protected.table_name AS "tableName",
      COALESCE(c.relrowsecurity, false) AS "rlsEnabled",
      EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = protected.table_name
          AND p.roles && ARRAY['public', 'anon', 'authenticated']::name[]
      ) AS "hasDataApiPolicy",
      EXISTS (
        SELECT 1 FROM pg_roles r
        WHERE r.rolname IN ('anon', 'authenticated')
          AND c.oid IS NOT NULL
          AND (
            has_table_privilege(r.oid, c.oid, 'SELECT')
            OR has_table_privilege(r.oid, c.oid, 'INSERT')
            OR has_table_privilege(r.oid, c.oid, 'UPDATE')
            OR has_table_privilege(r.oid, c.oid, 'DELETE')
          )
      ) AS "hasDataApiGrant"
    FROM (SELECT unnest(ARRAY[${quoted}]::text[]) AS table_name) protected
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = protected.table_name
    ORDER BY protected.table_name
  `);
  const result = rows.map((row) => ({
    table: row.tableName,
    rls: row.rlsEnabled,
    dataApiPolicy: row.hasDataApiPolicy,
    dataApiGrant: row.hasDataApiGrant
  }));
  console.table(result);
  if (result.some((row) => !row.rls || row.dataApiPolicy || row.dataApiGrant)) {
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
