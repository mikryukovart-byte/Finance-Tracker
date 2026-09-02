# Database security

The application uses Supabase Auth, but all application-table reads and writes go through authenticated Next.js API routes and server-side Prisma. No browser component uses the Supabase Data API.

The following tables are server-only and intentionally have RLS enabled with no `anon` or `authenticated` policies: `AdvisorReport`, `DailyActionLog`, `TelegramPendingAction`, `TelegramPendingWorkRecord`, `WorkRecord`, `MonthlyTaktLevel`, `ThreeYearGoalScenario`, `AnnualGoalRow`, `AnnualGoalPlan`, `CrisisSettings`, and `WeeklyHypothesis`.

The existing production database was updated with the exact SQL from [the Work Records migration](../prisma/migrations/20260702150000_work_records/migration.sql) via `prisma db execute`. This path was required because its Prisma migration history is not baselined. Do not use `prisma db push` for WorkRecord or raw SQL security changes, and do not run `prisma migrate deploy` against the existing database unless its migration history has first been deliberately and completely baselined.

The server-only RLS rules are defined by [the RLS hardening migration](../prisma/migrations/20260702120000_harden_server_only_rls/migration.sql), the Work Records migration, and [the Advisor Reports migration](../prisma/migrations/20260902120000_advisor_reports/migration.sql). The production database is not baselined in Prisma migration history. Apply the Advisor migration before deploying its application code with `npx prisma db execute --file prisma/migrations/20260902120000_advisor_reports/migration.sql --schema prisma/schema.prisma`. Do not use `prisma db push`, reset the database, or run `prisma migrate deploy` until the existing migration history has been deliberately baselined. Run [the verification queries](sql/verify-rls.sql) in Supabase SQL Editor after security changes. The first and third queries must return no rows; every row in the second query must show `true`, `false`, `false`.

Every new public user-data table must have RLS enabled before production deployment.
