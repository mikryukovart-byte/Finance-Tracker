# Telegram Daily Actions: настройка MVP

Бот принимает только текст и голосовые сообщения с Daily Actions. Он показывает распознанный черновик и записывает его в `DailyActionLog` только после нажатия «Сохранить».

## 1. Переменные окружения Vercel

Добавьте в Vercel для нужных окружений и затем сделайте новый deploy:

```bash
TELEGRAM_BOT_TOKEN="токен от BotFather"
TELEGRAM_WEBHOOK_SECRET="случайная длинная строка для Telegram webhook"
TELEGRAM_ALLOWED_CHAT_ID="единственный разрешённый Telegram chat id"
TELEGRAM_TRACKER_USER_ID="Supabase Auth user id владельца трекера"
TELEGRAM_SETUP_SECRET="отдельная случайная длинная строка для setup route"
```

Также должен быть настроен существующий `OPENAI_API_KEY`. Не добавляйте префикс `NEXT_PUBLIC_` к Telegram-переменным: все они должны оставаться серверными.

## 2. Создание бота

1. Откройте официальный чат `@BotFather` в Telegram.
2. Выполните `/newbot`, задайте имя и username.
3. Сохраните полученный токен в `TELEGRAM_BOT_TOKEN` в Vercel.
4. Никому не пересылайте токен и никогда не коммитьте его в git.

## 3. Получение chat ID

До настройки webhook отправьте боту `/start`, затем локально выполните запрос к `getUpdates`, не публикуя токен и вывод команды:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"
```

Возьмите числовое значение `message.chat.id` из собственного сообщения и запишите его в `TELEGRAM_ALLOWED_CHAT_ID`. После этого удалите локальный токен из истории shell, если вводили его непосредственно в команду. Для группового чата ID может быть отрицательным; сравнение выполняется как точная строка.

`TELEGRAM_TRACKER_USER_ID` — это UUID пользователя из Supabase Authentication → Users, которому уже принадлежат данные трекера. Бот никогда не принимает этот ID из Telegram update.

## 4. Миграция и webhook

Для подтверждений используется таблица короткоживущих черновиков. Для текущей базы примените схему без reset:

```bash
npx prisma db push
```

Если Prisma предложит reset или сообщит о потере данных, откажитесь и остановитесь. Ничего не сбрасывайте. Если в production принят migration workflow, вместо `db push` примените включённую безопасную миграцию:

```bash
npx prisma migrate deploy
```

Настройте webhook защищённым route, подставив production URL и передав setup secret только в заголовке:

```bash
curl -X POST "https://YOUR_DOMAIN/api/telegram/setup-webhook" \
  -H "x-telegram-setup-secret: $TELEGRAM_SETUP_SECRET"
```

Успешный безопасный ответ: `{"ok":true}`. Route регистрирует `https://YOUR_DOMAIN/api/telegram/webhook` и передаёт Telegram значение `TELEGRAM_WEBHOOK_SECRET` как `secret_token`. Токен бота в ответе не возвращается.

## 5. Проверка

1. Отправьте `/start` и проверьте вводную подсказку.
2. Отправьте текст: `Отправил КП бассейну AquaLeader, завтра напомню.`
3. Проверьте поля черновика. До нажатия кнопки записи в трекере быть не должно.
4. Нажмите «Отмена» и убедитесь, что запись не создана.
5. Повторите ввод, нажмите «Сохранить» и проверьте запись на странице `/strategy/actions`.
6. Отправьте голосовое короче 90 секунд и повторите проверки сохранения и отмены.
7. Для проверки ограничения отправьте голосовое длиннее 90 секунд: бот должен попросить сократить его.

Черновики истекают через 30 минут. Не храните реальные токены в `.env.example`, документации, логах, issue или коммитах.
