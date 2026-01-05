// src/geocode.ts
import { delay } from "jsr:@std/async/delay";
import type { GeocodeResult } from "./types.ts";
import { getCache, setCache } from "./kv.ts";

let lastNominatimRequestMs = 0;

function normalizeKey(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function getUserAgent(): string {
  const ua = Deno.env.get("NOMINATIM_USER_AGENT");
  if (!ua) {
    // Hard fail: Nominatim requires a proper User-Agent.
    throw new Error(
      "NOMINATIM_USER_AGENT env var is required (must include contact info).",
    );
  }
  return ua;
}

function geocodeTtlMs(): number {
  const days = Number(Deno.env.get("CACHE_TTL_GEOCODE_DAYS") ?? "30");
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

async function throttle(): Promise<void> {
  const minInterval = 1100; // ~1 req/sec (basic best-effort)
  const now = Date.now();
  const wait = Math.max(0, minInterval - (now - lastNominatimRequestMs));
  if (wait > 0) await delay(wait);
  lastNominatimRequestMs = Date.now();
}

async function nominatimSearch(q: string): Promise<GeocodeResult | null> {
  await throttle();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", q);
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url, {
    headers: {
      "User-Agent": getUserAgent(),
      "Accept-Language": "en",
    },
  });

  if (!res.ok) {
    console.warn("Nominatim non-200:", res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as Array<
    { lat: string; lon: string; display_name?: string }
  >;
  if (!data?.length) return null;

  const item = data[0];
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng, displayName: item.display_name };
}

export async function geocodeAddress(
  kv: Deno.Kv,
  address: string,
): Promise<GeocodeResult | null> {
  const key = ["geocode", "address", normalizeKey(address)] as const;
  const cached = await getCache<GeocodeResult>(kv, key);
  if (cached) return cached;

  const result = await nominatimSearch(address);
  if (result) {
    await setCache(kv, key, result, geocodeTtlMs());
  }
  return result;
}

export async function geocodeCityState(
  kv: Deno.Kv,
  city: string,
  state: string,
): Promise<GeocodeResult | null> {
  const q = `${city}, ${state}, USA`;
  const key = ["geocode", "citystate", normalizeKey(q)] as const;
  const cached = await getCache<GeocodeResult>(kv, key);
  if (cached) return cached;

  const result = await nominatimSearch(q);
  if (result) {
    await setCache(kv, key, result, geocodeTtlMs());
  }
  return result;
}
