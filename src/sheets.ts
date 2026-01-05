import { getCache, setCache, delCache } from "./kv.ts";
import type { ShopRow } from "./types.ts";

const HEADER = [
  "createdAtISO",
  "shopName",
  "address",
  "city",
  "state",
  "phone",
  "contactPerson",
  "staffType",
  "servicesCSV",
  "notes",
  "lat",
  "lng",
] as const;

function sheetId(): string {
  const id = Deno.env.get("GOOGLE_SHEET_ID");
  if (!id) throw new Error("GOOGLE_SHEET_ID env var is required");
  return id;
}

function sheetTab(): string {
  return Deno.env.get("GOOGLE_SHEET_TAB") ?? "Shops";
}

function sheetCacheTtlMs(): number {
  const sec = Number(Deno.env.get("CACHE_TTL_SHEET_SECONDS") ?? "600");
  return Math.max(60, sec) * 1000;
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function loadServiceAccount(): ServiceAccount {
  const b64 = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_B64");
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 env var is required");

  const jsonStr = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const sa = JSON.parse(jsonStr) as ServiceAccount;

  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON must include client_email and private_key");
  }
  return sa;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwtRS256(privateKeyPem: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(data),
  );
  return base64UrlEncode(new Uint8Array(sig));
}

async function getAccessToken(kv: Deno.Kv): Promise<string> {
  const cached = await getCache<{ token: string; expiresAtMs: number }>(kv, ["google", "token"]);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.token;
  }

  const sa = loadServiceAccount();
  const nowSec = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
        iat: nowSec,
        exp: nowSec + 3600,
      }),
    ),
  );

  const unsigned = `${header}.${payload}`;
  const signature = await signJwtRS256(sa.private_key, unsigned);
  const assertion = `${unsigned}.${signature}`;

  const tokenUrl = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number; token_type: string };
  const expiresAtMs = Date.now() + (data.expires_in ?? 3600) * 1000;

  await setCache(kv, ["google", "token"], { token: data.access_token, expiresAtMs }, (data.expires_in - 60) * 1000);
  return data.access_token;
}

async function sheetsFetch(
  kv: Deno.Kv,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken(kv);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}`;
  return await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function readValues(kv: Deno.Kv, rangeA1: string): Promise<string[][]> {
  const res = await sheetsFetch(
    kv,
    `/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`,
    { method: "GET" },
  );

  if (!res.ok) {
    throw new Error(`Sheets read error: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

async function updateValues(kv: Deno.Kv, rangeA1: string, values: string[][]): Promise<void> {
  const res = await sheetsFetch(
    kv,
    `/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    },
  );
  if (!res.ok) {
    throw new Error(`Sheets update error: ${res.status} ${await res.text()}`);
  }
}

export async function ensureHeaderRow(kv: Deno.Kv): Promise<void> {
  const tab = sheetTab();
  const range = `${tab}!A1:L1`;
  const values = await readValues(kv, range);
  const row = values[0] ?? [];
  const isEmpty = row.length === 0;
  const matches = row.join("|") === HEADER.join("|");
  if (isEmpty) {
    await updateValues(kv, range, [Array.from(HEADER)]);
  } else if (!matches) {
    // Don't overwrite an existing different header: safer to fail loudly.
    throw new Error(
      `Sheet header mismatch on ${range}. Expected: ${HEADER.join(", ")}. Found: ${row.join(", ")}`,
    );
  }
}

function parseRow(row: string[]): ShopRow | null {
  if (!row?.length) return null;
  // If header row, skip
  if (row[0] === "createdAtISO") return null;

  const latRaw = row[10] ?? "";
  const lngRaw = row[11] ?? "";
  const lat = latRaw ? Number(latRaw) : null;
  const lng = lngRaw ? Number(lngRaw) : null;

  return {
    createdAtISO: row[0] ?? "",
    shopName: row[1] ?? "",
    address: row[2] ?? "",
    city: row[3] ?? "",
    state: row[4] ?? "",
    phone: row[5] ?? "",
    contactPerson: row[6] ?? "",
    staffType: row[7] ?? "",
    servicesCSV: row[8] ?? "",
    notes: row[9] ?? "",
    lat: Number.isFinite(lat as number) ? lat : null,
    lng: Number.isFinite(lng as number) ? lng : null,
  };
}

export async function getAllShops(kv: Deno.Kv): Promise<ShopRow[]> {
  const cacheKey = ["sheet", "shops", "rows"] as const;
  const cached = await getCache<ShopRow[]>(kv, cacheKey);
  if (cached) return cached;

  await ensureHeaderRow(kv);

  const tab = sheetTab();
  const values = await readValues(kv, `${tab}!A:L`);
  const rows: ShopRow[] = [];
  for (const r of values) {
    const parsed = parseRow(r);
    if (parsed) rows.push(parsed);
  }

  await setCache(kv, cacheKey, rows, sheetCacheTtlMs());
  return rows;
}

export async function invalidateShopsCache(kv: Deno.Kv): Promise<void> {
  await delCache(kv, ["sheet", "shops", "rows"]);
}

export async function appendShopRow(
  kv: Deno.Kv,
  row: string[],
): Promise<void> {
  if (row.length !== 12) {
    throw new Error(`appendShopRow expects 12 columns, got ${row.length}`);
  }

  await ensureHeaderRow(kv);

  const tab = sheetTab();
  const range = `${tab}!A:L`;

  const res = await sheetsFetch(
    kv,
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [row] }),
    },
  );

  if (!res.ok) {
    throw new Error(`Sheets append error: ${res.status} ${await res.text()}`);
  }

  // Invalidate cached rows since the sheet changed
  await invalidateShopsCache(kv);
}
