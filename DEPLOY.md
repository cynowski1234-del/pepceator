# Wdrożenie PEP BOT: Supabase + hosting bota + Vercel

```
Hosting bota (bot.js)  ──►  Supabase (baza)  ◄──  Vercel (panel PEP Creators)
ochrona, AI, raporty        ustawienia, frazy,     logowanie przez Discord,
działa 24/7                 logi, pytania, rangi   zarządzanie
```

- **Bot** musi działać bez przerwy, więc idzie na hosting botów (Pterodactyl, VPS, Railway…), **nie na Vercel**.
- **Panel** działa na Vercelu i rozmawia z botem przez wspólną bazę **Supabase**.
- Lokalnie (bez kluczy Supabase w `.env`) wszystko działa jak dotąd, na plikach w `data/`.

---

## 1. Supabase – baza danych

1. Załóż projekt na https://supabase.com (region najlepiej **Frankfurt / eu-central**).
2. **SQL Editor → New query** → wklej całą zawartość pliku [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Project Settings → API** – zapisz:
   - **Project URL** → to będzie `SUPABASE_URL`
   - klucz **`service_role`** (sekcja *Project API keys*, „Reveal”) → to będzie `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ Klucz `service_role` ma pełny dostęp do bazy. Wpisuj go tylko w zmienne środowiskowe (hosting, Vercel, `.env`) –
> nigdy na czacie, na zrzucie ekranu ani w kodzie wrzucanym do GitHuba.

## 2. Przeniesienie obecnych danych do Supabase

Na swoim komputerze, w pliku `.env` uzupełnij `SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY`, potem w folderze bota:

```
npm run migrate:supabase
```

Przeniesie: kanał raportów, zablokowane frazy, kanały ochrony, zapamiętane obrazki scamu, logi/zdarzenia,
osoby dodane w panelu oraz bazę pytań (`wiedza.md`). Można uruchomić ponownie – nic się nie zdubluje.

## 3. Hosting bota

**Wymagania:** Node.js **20.9 lub nowszy**, RAM **1 GB** (z czytaniem obrazków) albo 512 MB z `OCR_ENABLED=false`.

1. Wgraj na hosting **cały folder bota bez**: `node_modules/`, `data/`, `.env`, `test/`.
2. Plik startowy: **`bot.js`** (albo komenda startowa `npm start`). Hosting powinien sam zrobić `npm install`.
3. Ustaw zmienne środowiskowe (zakładka *Startup / Variables / Environment* w hostingu):

| Zmienna | Wartość |
|---|---|
| `DISCORD_TOKEN` | token bota |
| `GUILD_ID` | ID serwera głównego |
| `DEV_GUILD_ID` | ID serwera developerskiego |
| `GEMINI_API_KEY` | klucz Gemini |
| `SUPABASE_URL` | z kroku 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | z kroku 1 |
| `OCR_ENABLED` | `true` (albo `false` na słabym hostingu) |

   Jeśli hosting nie ma zmiennych – wgraj plik `.env` (z tymi wartościami) obok `bot.js`.
4. Uruchom. W konsoli powinno być: `🗄️ Supabase: dane wczytane` i `✅ Zalogowano jako PEP BOT`.

> ⚠️ **Wyłącz bota na swoim komputerze**, kiedy działa na hostingu – dwa boty z tym samym tokenem
> robiłyby wszystko podwójnie.

## 4. Vercel – panel

1. Wrzuć folder bota do repozytorium na GitHubie (bez `.env`, `data/`, `node_modules/` – są w `.gitignore`).
2. https://vercel.com → **Add New → Project** → wybierz repozytorium → **Deploy**
   (ustawienia są w [`vercel.json`](vercel.json), nic nie trzeba zmieniać).
3. **Settings → Environment Variables** – dodaj:

| Zmienna | Wartość |
|---|---|
| `DISCORD_TOKEN` | token bota (panel czyta listę serwerów i kanałów) |
| `DISCORD_CLIENT_SECRET` | Client Secret (Developer Portal → OAuth2) |
| `PANEL_SESSION_SECRET` | wartość z Twojego `.env` (64 znaki) |
| `SUPABASE_URL` | z kroku 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | z kroku 1 |
| `GUILD_ID`, `DEV_GUILD_ID` | jak na hostingu |
| `PANEL_URL` | adres panelu, np. `https://pep-creators.vercel.app` |

4. **Deployments → … → Redeploy** (zmienne działają dopiero po ponownym wdrożeniu).

## 5. Discord – logowanie do panelu

Developer Portal → Twoja aplikacja → **OAuth2 → Redirects → Add Redirect**:

```
https://TWOJA-DOMENA.vercel.app/auth/callback
```

(dokładnie ten sam adres co `PANEL_URL` + `/auth/callback`) → **Save Changes**.

## 6. Sprawdzenie

- [ ] Panel na Vercelu: logowanie przez Discord działa, Pulpit pokazuje **bota online**.
- [ ] Zmiana w panelu (np. nowa fraza) działa na Discordzie w ciągu **30 sekund**.
- [ ] Usunięty scam pojawia się w **Anty Spam → Logi użytkownika**.
- [ ] Przycisk **Wyślij raport teraz** wysyła raport na kanał raportów.

Przed wdrożeniem możesz sprawdzić panel w trybie Vercela u siebie: `npm run panel:vercel-local`
→ http://localhost:3001 (dodaj w Discordzie redirect `http://localhost:3001/auth/callback`).

## Zmiany w plikach po wdrożeniu

`whitelist.js`, `rangi.js` i folder `instrukcje/` są częścią kodu – po zmianie wgraj je ponownie na hosting
**i** zrób nowe wdrożenie na Vercelu (push do GitHuba robi to automatycznie). Wszystko inne
(pytania, frazy, kanały, osoby z rangami) zmieniasz w panelu – zapisuje się w Supabase.

## Gdy coś nie działa

| Objaw | Przyczyna |
|---|---|
| Panel: „Panel nie jest skonfigurowany: brakuje zmiennych…” | brak zmiennej na Vercelu – dodaj i zrób Redeploy |
| Discord: „Invalid OAuth2 redirect_uri” | redirect w Developer Portal ≠ `PANEL_URL/auth/callback` |
| Pulpit: bot **offline** | bot na hostingu nie działa albo ma inne `SUPABASE_URL` niż panel |
| Konsola bota: `Supabase: relation … does not exist` | nie uruchomiono `supabase/schema.sql` |
| Bot na hostingu się restartuje / brak pamięci | ustaw `OCR_ENABLED=false` albo większy plan RAM |
