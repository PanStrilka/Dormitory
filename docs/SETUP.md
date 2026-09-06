# Налаштування бекенду (Supabase) — покроково

Щоб працювали **спільна синхронізація між усіма**, **верифікація нових людей**,
**фото чеків із ШІ-розбором** і **пуш-сповіщення**, потрібен безкоштовний
бекенд. Ми беремо **Supabase** (безкоштовний план цілком достатній).

Робимо **етапами**. Зроби Етап 1 — далі я підключу застосунок до бази, і рушимо
до Етапів 2 і 3.

---

## 🔐 Що секретне, а що ні

- **Публічний (anon) ключ** і **URL проєкту** — можна давати мені й вставляти в
  застосунок. Вони захищені кодом буньки та правилами доступу.
- **service_role ключ**, **ключ ШІ**, **приватний ключ пушів** — **секретні**.
  Вони живуть у *Supabase → Edge Functions → Secrets* (на сервері). Я їх **не
  бачу** і в код вони не потрапляють.

---

## ✅ Етап 1 — База даних (потрібно зараз)

1. Зайди на **<https://supabase.com>** → **Start your project** → увійди
   (можна через GitHub).
2. **New project**:
   - *Name*: `bulka`
   - *Database Password*: згенеруй і збережи (знадобиться рідко).
   - *Region*: обери найближчий (напр. **Central EU (Frankfurt)**).
   - Натисни **Create new project**, зачекай ~2 хв, поки підніметься.
3. Ліворуч відкрий **SQL Editor** → **New query**.
4. Встав **увесь вміст файлу [`supabase/schema.sql`](../supabase/schema.sql)** і
   натисни **Run**. Має з'явитися `Success. No rows returned`.
5. Ліворуч **Project Settings** (шестерня) → **API**. Скопіюй:
   - **Project URL** (виду `https://xxxxxxxx.supabase.co`)
   - **anon public** ключ (довгий рядок, починається на `eyJ...`)
6. **Надішли мені ці два значення** (URL + anon public). Секретні ключі не треба.

> Хочеш перевірити вже зараз? У застосунку: **Nastavení → Data a synchronizace**
> — встав URL і anon-ключ, натисни **Uložit a synchronizovat**. Зелена крапка
> вгорі = працює. (Повноцінну верифікацію/чеки/пуші підключу я на наступних кроках.)

---

## 🗂️ Етап 2 — Сховище чеків + ШІ-розбір (після Етапу 1)

Коли база готова:

1. **Storage** (ліворуч) → **New bucket** → назва **точно `receipts`** (маленькими,
   назву потім не змінити!), Public **вимкнено** (Private) → **Create**.
1b. Оскільки в Storage свій окремий RLS, дай anon-ключу доступ до цього бакета —
   **SQL Editor → Run** (це вже є в кінці `supabase/schema.sql`, тож якщо
   виконаєш весь файл ще раз після створення бакета — політики додадуться самі):
   ```sql
   create policy "receipts anon insert" on storage.objects
     for insert to anon with check (bucket_id = 'receipts');
   create policy "receipts anon select" on storage.objects
     for select to anon using (bucket_id = 'receipts');
   ```
2. Заведи ключ ШІ (Claude API) на <https://console.anthropic.com> → **API Keys**
   → **Create Key**. Це **секрет** — його **не надсилай мені**.
3. **Edge Functions → Secrets** → додай:
   - `ANTHROPIC_API_KEY` = твій ключ ШІ
   - *(необовʼязково)* `ANTHROPIC_MODEL` = `claude-haiku-4-5` — дешевша модель для
     чеків (рекомендовано для економії; без цього використовується `claude-opus-5`).
4. Функція вже готова в репозиторії: **[`supabase/functions/parse-receipt/index.ts`](../supabase/functions/parse-receipt/index.ts)**.
   Розгорни її: **Edge Functions → Deploy a new function**, назва `parse-receipt`,
   встав вміст файлу. (Розбирає фото чека в таблицю товарів; якщо ШІ недоступний —
   лишає фото й запис на кілька днів для повторної спроби.)
5. *(для погашення боргу переказом)* розгорни також
   **[`supabase/functions/verify-transfer/index.ts`](../supabase/functions/verify-transfer/index.ts)**,
   назва `verify-transfer`. Використовує той самий ключ ШІ та bucket `receipts`.
   Перевіряє, чи фото банківського підтвердження схоже на справжнє й на потрібну
   суму, і пише вердикт у таблицю `transfers` (verified / rejected / unclear).
   Без цієї функції погашення переказом усе одно працює — фото зберігається як
   доказ, лише без автоперевірки ШІ.

Як це працюватиме: додаєш витрату й прикріплюєш фото чека → функція просить ШІ
розпізнати позиції (назва / кількість / ціна) → вони пишуться в таблицю
`receipt_items` (зберігаються довго). Якщо ШІ віддав помилку — фото й чек лежать
у сховищі ~7 днів (їх видно й можна перевірити), а розкладуться в таблицю
пізніше — при повторній спробі або коли робиш підрахунок.

---

## 🔔 Етап 3 — Пуш-сповіщення «твоя черга» (після Етапу 2)

Клієнт і серверна функція вже готові в репозиторії. Лишається завести VAPID-ключі.

1. **Згенеруй пару VAPID-ключів** (публічний + приватний):
   - онлайн: <https://vapidkeys.com> (натисни Generate), або
   - у терміналі: `npx web-push generate-vapid-keys`
2. **Edge Functions → Secrets** → додай:
   - `VAPID_PUBLIC_KEY` = публічний ключ
   - `VAPID_PRIVATE_KEY` = приватний ключ *(секрет — мені не надсилай)*
   - `VAPID_SUBJECT` = `mailto:твоя@пошта`
3. Розгорни функцію **[`supabase/functions/notify-duty/index.ts`](../supabase/functions/notify-duty/index.ts)**
   (Edge Functions → Deploy a new function, назва `notify-duty`).
4. У застосунку: **Nastavení → Oznámení** → встав **публічний** VAPID-ключ →
   кожен натискає «🔔 Zapnout oznámení na tomto zařízení».
5. **Розклад** (щопонеділка о 8:00). У SQL Editor (потрібні розширення `pg_cron`
   і `pg_net`, увімкни їх у Database → Extensions):
   ```sql
   select cron.schedule('bulka-duty', '0 8 * * 1', $$
     select net.http_post(
       url := 'https://<TVŮJ-PROJEKT>.supabase.co/functions/v1/notify-duty',
       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
     );
   $$);
   ```

> На iPhone пуші працюють, лише якщо спершу **додати сайт на екран Домівки**
> (Safari → Поділитися → На екран «Домівки»).

---

## 🏢 Етап 5 — Акаунти + мультибуньки (велике; готуємо фундамент)

Це для «правильної» версії з логінами, багатьма буньками (2A/2B…), ролями та
панеллю адміна. Роби це, коли будемо активувати панель — я скажу.

1. **Authentication → Providers → Email** → увімкни (магічне посилання/OTP;
   «Confirm email» можна лишити як є).
2. **Authentication → URL Configuration**:
   - **Site URL:** `https://panstrilka.github.io/Dormitory/`
   - Додай цю ж адресу в **Redirect URLs**.
3. **SQL Editor → New query** → встав увесь [`supabase/schema-auth.sql`](../supabase/schema-auth.sql) → **Run**.
   *(Він не чіпає теперішні таблиці — живий сайт працює далі.)*
4. Один раз **увійди** в застосунок своєю поштою (коли підключу екран входу).
5. Признач себе супер-адміном — **SQL Editor → Run** (встав свою пошту):
   ```sql
   update profiles set is_superadmin = true
   where id = (select id from auth.users where email = 'ТВОЯ-ПОШТА');
   ```
6. Далі я підключаю **екран входу + панель управління**: ти (супер-адмін)
   створюєш буньки й призначаєш адмінів; кожен адмін схвалює людей у свою буньку;
   нові люди обирають буньку + кімнату (A/B) і чекають на схвалення.

> ⚠️ Поки клієнт не переключений на логіни, все працює як зараз (одна буньк­а,
> коди). Перемкнемо, коли ти зробиш кроки 1–3 і скажеш «готово».

---

## Підсумок: що зробити тобі зараз

1. Створити проєкт Supabase (Етап 1, кроки 1–2).
2. Виконати `supabase/schema.sql` у SQL Editor.
3. Надіслати мені **Project URL** і **anon public** ключ.

Далі — моя черга: підключу синхронізацію, код буньки й верифікацію, і рушимо до
чеків і пушів.
