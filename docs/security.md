# Database security

The application uses Supabase Auth, but all application-table reads and writes go through authenticated Next.js API routes and server-side Prisma. No browser component uses the Supabase Data API.

The following tables are server-only and intentionally have RLS enabled with no `anon` or `authenticated` policies: `DailyActionLog`, `TelegramPendingAction`, `MonthlyTaktLevel`, `ThreeYearGoalScenario`, `AnnualGoalRow`, `AnnualGoalPlan`, `CrisisSettings`, and `WeeklyHypothesis`.

Apply [the RLS hardening migration](../prisma/migrations/20260702120000_harden_server_only_rls/migration.sql) with `npx prisma migrate deploy`, or paste that file into Supabase SQL Editor. Do not use `prisma db push` for raw SQL security policy changes. Then run [the verification queries](sql/verify-rls.sql) in Supabase SQL Editor. The first and third queries must return no rows; every row in the second query must show `true`, `false`, `false`.

Every new public user-data table must have RLS enabled before production deployment.
