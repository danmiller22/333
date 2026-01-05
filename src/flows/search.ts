// src/flows/search.ts
import type { Context } from "npm:grammy@1.21.1";
import { InlineKeyboard } from "npm:grammy@1.21.1";
import type { FlowState, SearchResult } from "../types.ts";
import { setFlowState, clearFlowState, getCache, setCache } from "../kv.ts";
import { geocodeCityState } from "../geocode.ts";
import { getAllShops } from "../sheets.ts";
import { haversineMiles } from "../distance.ts";
import { mainMenuKeyboard } from "./menu.ts";

type BotContext = Context & { kv: Deno.Kv };

const SEARCH_TTL_MS = 15 * 60 * 1000; // store results for paging

function requireChatUser(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) throw new Error("Missing chat/user");
  return { chatId, userId };
}

function parseCityState(text: string): { city: string; state: string } | null {
  const m = text.trim().match(/^(.+?),\s*([A-Za-z]{2})$/);
  if (!m) return null;
  return { city: m[1].trim(), state: m[2].toUpperCase() };
}

function paginationKeyboard(page: number, totalPages: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (page > 0) kb.text("⬅ Prev", `search:page:${page - 1}`);
  if (page < totalPages - 1) kb.text("Next ➡", `search:page:${page + 1}`);
  kb.row().text("Main menu", "search:menu");
  return kb;
}

function formatResultLine(r: SearchResult, idx: number): string {
  const s = r.shop;
  const services = s.servicesCSV || "";
  const notes = s.notes ? `\nNotes: ${s.notes}` : "";
  return [
    `${idx}. ${r.distanceMiles.toFixed(1)} mi - ${s.shopName}`,
    `${s.address}, ${s.city}, ${s.state}`,
    `Phone: ${s.phone} | Contact: ${s.contactPerson}`,
    `Staff: ${s.staffType} | Services: ${services}`,
    notes,
  ].filter(Boolean).join("\n");
}

function buildSearchCacheKey(chatId: number, userId: number) {
  return ["search", "results", chatId, userId] as const;
}

async function storeResults(ctx: BotContext, results: SearchResult[], query: string) {
  const { chatId, userId } = requireChatUser(ctx);
  await setCache(
    ctx.kv,
    buildSearchCacheKey(chatId, userId),
    { results, query },
    SEARCH_TTL_MS,
  );
}

async function loadStoredResults(
  ctx: BotContext,
): Promise<{ results: SearchResult[]; query: string } | null> {
  const { chatId, userId } = requireChatUser(ctx);
  return await getCache<{ results: SearchResult[]; query: string }>(
    ctx.kv,
    buildSearchCacheKey(chatId, userId),
  );
}

async function renderPage(
  ctx: BotContext,
  page: number,
  payload: { results: SearchResult[]; query: string },
) {
  const pageSize = 10;
  const total = payload.results.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);

  const start = safePage * pageSize;
  const end = Math.min(total, start + pageSize);
  const slice = payload.results.slice(start, end);

  const header = `Results for ${payload.query} (within 100 miles) — showing ${start + 1}-${end} of ${total}`;
  const lines = slice.map((r, i) => formatResultLine(r, start + i + 1));
  const msg = [header, "", ...lines].join("\n");

  await ctx.reply(msg, { reply_markup: paginationKeyboard(safePage, totalPages) });
}

async function computeResultsFromCenter(
  ctx: BotContext,
  centerLat: number,
  centerLng: number,
): Promise<SearchResult[]> {
  const shops = await getAllShops(ctx.kv);

  const results: SearchResult[] = [];
  for (const s of shops) {
    if (s.lat == null || s.lng == null) continue;
    const d = haversineMiles(centerLat, centerLng, s.lat, s.lng);
    if (d <= 100) results.push({ shop: s, distanceMiles: d });
  }

  results.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return results;
}

export async function startSearch(ctx: BotContext): Promise<void> {
  const { chatId, userId } = requireChatUser(ctx);
  const state: FlowState = { flow: "search", step: "awaitQuery" };
  await setFlowState(ctx.kv, chatId, userId, state);
  await ctx.reply(
    'Send city and state like: "Dallas, TX"\nOr send your Telegram location.',
    { reply_markup: new InlineKeyboard().text("✖ Cancel", "search:cancel") },
  );
}

export async function tryInlineSearch(ctx: BotContext, text: string): Promise<boolean> {
  const parsed = parseCityState(text);
  if (!parsed) return false;
  await runSearchByCityState(ctx, parsed.city, parsed.state);
  return true;
}

export async function handleSearchText(
  ctx: BotContext,
  state: FlowState & { flow: "search" },
  text: string,
): Promise<boolean> {
  if (state.step !== "awaitQuery") return false;
  const parsed = parseCityState(text);
  if (!parsed) {
    await ctx.reply('Format must be "City, ST" (example: Dallas, TX). Try again, send location, or Cancel.', {
      reply_markup: new InlineKeyboard().text("✖ Cancel", "search:cancel"),
    });
    return true;
  }
  await runSearchByCityState(ctx, parsed.city, parsed.state);
  return true;
}

// NEW: public function for main.ts (location search)
export async function runSearchByCoords(
  ctx: BotContext,
  lat: number,
  lng: number,
): Promise<void> {
  const { chatId, userId } = requireChatUser(ctx);

  await ctx.reply("Searching within 100 miles of your location...");

  const results = await computeResultsFromCenter(ctx, lat, lng);

  // Clear any search state (safety)
  await clearFlowState(ctx.kv, chatId, userId);

  if (results.length === 0) {
    await ctx.reply(
      "No shops found within 100 miles of your location.\n\nSuggestion: add more shops (with full addresses so geocoding works).",
      { reply_markup: mainMenuKeyboard() },
    );
    return;
  }

  const queryText = "your location";
  await storeResults(ctx, results, queryText);
  await renderPage(ctx, 0, { results, query: queryText });
}

async function runSearchByCityState(ctx: BotContext, city: string, state: string) {
  const { chatId, userId } = requireChatUser(ctx);

  await ctx.reply(`Searching within 100 miles of ${city}, ${state}...`);

  const geo = await geocodeCityState(ctx.kv, city, state);
  if (!geo) {
    await ctx.reply(
      `I couldn't geocode "${city}, ${state}". Try a different city/state format.`,
      { reply_markup: mainMenuKeyboard() },
    );
    await clearFlowState(ctx.kv, chatId, userId);
    return;
  }

  const results = await computeResultsFromCenter(ctx, geo.lat, geo.lng);

  await clearFlowState(ctx.kv, chatId, userId);

  if (results.length === 0) {
    await ctx.reply(
      `No shops found within 100 miles of ${city}, ${state}.\n\nSuggestion: add more shops (with full addresses so geocoding works).`,
      { reply_markup: mainMenuKeyboard() },
    );
    return;
  }

  const queryText = `${city}, ${state}`;
  await storeResults(ctx, results, queryText);
  await renderPage(ctx, 0, { results, query: queryText });
}

export async function handleSearchCallback(ctx: BotContext, data: string): Promise<boolean> {
  const { chatId, userId } = requireChatUser(ctx);

  if (data === "search:cancel") {
    await clearFlowState(ctx.kv, chatId, userId);
    await ctx.answerCallbackQuery();
    await ctx.reply("Cancelled. Main menu:", { reply_markup: mainMenuKeyboard() });
    return true;
  }

  if (data === "search:menu") {
    await ctx.answerCallbackQuery();
    await ctx.reply("Main menu:", { reply_markup: mainMenuKeyboard() });
    return true;
  }

  if (data.startsWith("search:page:")) {
    const page = Number(data.replace("search:page:", ""));
    const payload = await loadStoredResults(ctx);
    await ctx.answerCallbackQuery();
    if (!payload) {
      await ctx.reply("Search results expired. Please search again.", { reply_markup: mainMenuKeyboard() });
      return true;
    }
    await renderPage(ctx, page, payload);
    return true;
  }

  return false;
}
