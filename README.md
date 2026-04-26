# Личный финансовый трекер

Минималистичное веб-приложение на Next.js App Router, TypeScript, Tailwind CSS, Prisma и Supabase PostgreSQL.

## Возможности

- Главная с доходами, расходами, балансом, быстрым вводом и ежедневным контролем.
- Страница «Правда» с чистой позицией, долгами и расчетом выхода в ноль.
- CRUD для операций, пользовательских категорий и кредитов/долгов.
- Автоматическое создание категорий из быстрого ввода.
- Фильтры и сортировка операций.
- Отчеты на Recharts: категории, месячная динамика, доходы против расходов, утечки и прогресс долгов.
- Экспорт, импорт JSON и безопасный сброс данных в разделе «Настройки».
- Supabase Auth: данные каждого пользователя изолированы через `userId`.

## Переменные окружения

Создайте `.env` локально и такие же переменные в Vercel:

```bash
DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://[PROJECT_REF].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="[SUPABASE_ANON_KEY]"
```

`DATABASE_URL` используется приложением в runtime. `DIRECT_URL` используется Prisma для миграций.

## Локальный запуск

```bash
npm install
npx prisma generate
npm run dev
```

Для локальной работы нужен доступ к Supabase-проекту и заполненные переменные окружения.

## Миграции

После создания Supabase-проекта примените миграции:

```bash
npx prisma migrate deploy
```

Опционально для демо-данных одного пользователя:

```bash
SEED_USER_ID="[supabase-user-id]" npm run db:seed
```

Без `SEED_USER_ID` seed не добавляет демо-данные.

## Деплой на Vercel

1. Создайте проект Supabase.
2. В Supabase включите Email Auth в разделе Authentication.
3. Скопируйте `Project URL` в `NEXT_PUBLIC_SUPABASE_URL`.
4. Скопируйте `anon public` key в `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Возьмите pooled connection string для `DATABASE_URL`.
6. Возьмите direct connection string для `DIRECT_URL`.
7. Добавьте все переменные окружения в Vercel.
8. Выполните миграции командой `npx prisma migrate deploy` из локальной машины или CI с теми же env.
9. Задеплойте проект в Vercel.

Команда сборки:

```bash
npm run build
```

## Команды

```bash
npm run dev
npm run build
npm run db:migrate
npm run db:push
npm run db:seed
npm run db:studio
```
