# Truck Shop Finder Telegram Bot (Deno Deploy + Google Sheets)

A production-ready Telegram bot that manages a list of “good truck shops” in **Google Sheets** and can **search within 100 miles** of a given city/state. Runs on **Deno Deploy (free tier)** with a **webhook**. Uses **OpenStreetMap Nominatim** for geocoding with caching + basic rate limiting.

## Features
- ➕ **Add shop** via guided wizard (inline buttons + prompts)
  - Validates required fields (state format, non-empty phone/address/contact)
  - Auto-geocodes address → stores `lat/lng`
  - If geocoding fails: still saves with empty `lat/lng` and adds a warning to Notes
  - Confirmation screen with **Save / Edit / Cancel**
- 🔎 **Search (100 miles)**
  - Accepts `City, ST` (e.g., `Dallas, TX`) or via Search button prompt
  - Geocodes city/state center, loads shops from Google Sheet (cached), computes Haversine distance
  - Sorts nearest first, shows top 10 with **Next / Prev**
- 📄 **Last added** (last 10 appended rows)
- ❓ Help

## Architecture (high-level)
- **Deno Deploy webhook server** (`src/main.ts`)
  - `/health` healthcheck
  - webhook endpoint at `WEBHOOK_PATH`
  - optional security via Telegram `secret_token` header
- **State machine in Deno KV** (no DB required)
  - Wizard state for Add flow: `["state", chatId, userId]`
  - Cached sheet rows + cached geocodes (TTL-based)
- **Google Sheets API v4** via `fetch`
  - OAuth2 service account JWT (no Node-only libs)
  - Ensures header row exists before writing
- **Nominatim** geocoding with:
  - KV cache (default 30 days)
  - basic in-instance 1 req/sec throttling

---

## 1) Telegram setup
1. In Telegram, open `@BotFather`
2. Create a bot:
   - `/newbot` → choose name + username
3. Copy the bot token → you will set `TELEGRAM_BOT_TOKEN`

Optional but recommended:
- Generate a random secret (any string) for `TELEGRAM_SECRET_TOKEN`
  - Telegram will send this value in header `X-Telegram-Bot-Api-Secret-Token`
  - Your server will reject requests without the correct header

---

## 2) Google Sheet setup (schema)
1. Create a new Google Sheet (any name).
2. Create a tab named **`Shops`** (or set `GOOGLE_SHEET_TAB` to your tab name).
3. Share the sheet with your service account email (Editor).

### Column order (must match exactly)
The bot will **auto-create** the header row if the sheet is empty, using this exact order:

1. createdAtISO
2. shopName
3. address
4. city
5. state
6. phone
7. contactPerson
8. staffType
9. servicesCSV
10. notes
11. lat
12. lng

---

## 3) Google Cloud service account (Sheets API)
1. Create a Google Cloud project (or use an existing one).
2. Enable **Google Sheets API** for that project.
3. Create a **Service Account**.
4. Create a **JSON key** for the service account and download it.
5. Base64-encode the JSON file:
   - macOS/Linux:
     ```bash
     base64 -i service-account.json | tr -d '\n'
     ```
   - Windows PowerShell:
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
     ```

You will set:
- `GOOGLE_SERVICE_ACCOUNT_B64` = base64 of the entire JSON key file
- `GOOGLE_SHEET_ID` = the spreadsheet ID from the Sheet URL

---

## 4) Local dev (optional)
Create a `.env` file (copy from `.env.example`) and run:

```bash
deno task dev
```

This runs a local HTTP server. For local testing you can:
- either expose it with a tunnel (ngrok/cloudflared) and set webhook, **or**
- run in polling mode by setting `USE_POLLING=true` in `.env` (no webhook needed).

---

## 5) Deploy on Deno Deploy (from GitHub)
### A) Push to GitHub
1. Create a GitHub repo
2. Push this project

### B) Link on Deno Deploy
1. Go to Deno Deploy → **New Project**
2. Choose **Deploy from GitHub**
3. Select your repo + branch
4. Entry point: `src/main.ts`
5. Deploy

### C) Set environment variables (Deno Deploy → Project → Settings → Environment Variables)
Set at minimum:
- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_B64`
- `WEBHOOK_PATH` (example: `/tg-webhook`)
- `NOMINATIM_USER_AGENT` (must include contact info, example below)

Recommended:
- `TELEGRAM_SECRET_TOKEN` (random string)
- `GOOGLE_SHEET_TAB` (default `Shops`)

**Important:** Nominatim requires a proper User-Agent identifying your app and providing contact info. Example:
```
NOMINATIM_USER_AGENT=TruckShopFinderBot/1.0 (contact: your_email@example.com)
```

---

## 6) Set the Telegram webhook
After deployment, you’ll have a URL like:
- `https://YOUR_PROJECT_NAME.deno.dev`

Webhook endpoint is:
- `https://YOUR_PROJECT_NAME.deno.dev<WEBHOOK_PATH>`

### Ready-to-run curl command (recommended: with secret token)
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_PROJECT_NAME.deno.dev$WEBHOOK_PATH" \
  -d "secret_token=$TELEGRAM_SECRET_TOKEN"
```

If you are NOT using a secret token:
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_PROJECT_NAME.deno.dev$WEBHOOK_PATH"
```

---

## Commands / UX
- `/start` shows the main menu
- Main buttons:
  - ➕ Add shop
  - 🔎 Search (100 miles)
  - 📄 Last added
  - ❓ Help
- Search shortcut:
  - Send `City, ST` anytime (example: `Dallas, TX`)

---

## Troubleshooting
### Webhook not receiving updates
- Confirm webhook is set:
  ```bash
  curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
  ```
- Check `WEBHOOK_PATH` exactly matches your deployed route.
- If using `TELEGRAM_SECRET_TOKEN`, ensure:
  - you set it in Deno Deploy env vars
  - you passed it to `setWebhook` as `secret_token`

### Google Sheets errors
- Make sure the Sheet is shared with the service account email **as Editor**.
- Verify `GOOGLE_SHEET_ID` is correct (from the URL).
- Verify `GOOGLE_SERVICE_ACCOUNT_B64` decodes to valid JSON.

### Nominatim geocoding fails / empty results
- Ensure `NOMINATIM_USER_AGENT` is set and includes contact info.
- Try a more specific address format.
- The bot will still save the shop if address geocoding fails, with empty lat/lng and a warning in Notes.

### No shops found in search
- Many shops might have empty `lat/lng` if geocoding failed earlier.
- Add more shops with complete addresses.

---

## License
MIT
