import { serve } from "jsr:@std/http/server";
import { Bot, webhookCallback } from "npm:grammy@1.21.1";
import type { Context } from "npm:grammy@1.21.1";

import { openKv, getFlowState } from "./kv.ts";
import { sendMainMenu, mainMenuKeyboard } from "./flows/menu.ts";
import { startAddShop, handleAddShopText, handleAddShopCallback } from "./flows/addShop.ts";
import { startSearch, handleSearchText, handleSearchCallback, tryInlineSearch } from "./flows/search.ts";
import { getAllShops } from "./sheets.ts";

type BotContext = Context & { kv: Deno.Kv };

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function webhookPath(): string {
  const p = env("WEBHOOK_PATH");
  if (!p.startsWith("/")) throw new Error("WEBHOOK_PATH must start with '/'");
  return p;
}

function isDeploy(): boolean {
  // Present on Deno Deploy
  return Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"));
}

const USE_POLLING = (Deno.env.get("USE_POLLING") ?? "false").toLowerCase() === "true";

const kv = await openKv();
const bot = new Bot<BotContext>(env("TELEGRAM_BOT_TOKEN"));

bot.use(async (ctx, next) => {
  (ctx as BotContext).kv = kv;
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply("Welcome! I can store and search good truck shops.", { reply_markup: mainMenuKeyboard() });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "How to use:",
      "- Use the buttons to Add a shop or Search (100 miles).",
      '- You can also send "City, ST" directly (example: Dallas, TX).',
      "",
      "Data is stored in Google Sheets.",
    ].join("\n"),
    { reply_markup: mainMenuKeyboard() },
  );
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Menu callbacks
  if (data === "menu:add") {
    await ctx.answerCallbackQuery();
    await startAddShop(ctx as BotContext);
    return;
  }
  if (data === "menu:search") {
    await ctx.answerCallbackQuery();
    await startSearch(ctx as BotContext);
    return;
  }
  if (data === "menu:last") {
    await ctx.answerCallbackQuery();
    await handleLastAdded(ctx as BotContext);
    return;
  }
  if (data === "menu:help") {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      [
        "Help:",
        "- Add shop: guided wizard (buttons + prompts).",
        '- Search: send "City, ST" and I list shops within 100 miles.',
        "- Last added: shows the last 10 entries.",
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() },
    );
    return;
  }

  // Flow-specific callbacks
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const state = await getFlowState(kv, chatId, userId);
  if (state?.flow === "add") {
    const handled = await handleAddShopCallback(ctx as BotContext, state, data);
    if (handled) return;
  }
  if (state?.flow === "search") {
    const handled = await handleSearchCallback(ctx as BotContext, data);
    if (handled) return;
  }

  // Also allow paging even if no active flow state
  if (data.startsWith("search:page:") || data === "search:menu" || data === "search:cancel") {
    const handled = await handleSearchCallback(ctx as BotContext, data);
    if (handled) return;
  }

  await ctx.answerCallbackQuery({ text: "No action for that button." });
});

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const text = ctx.message.text;

  if (!chatId || !userId) return;

  // If the user sends City, ST at any time, attempt a search shortcut (unless they're in add flow)
  const existingState = await getFlowState(kv, chatId, userId);

  if (!existingState) {
    const didInlineSearch = await tryInlineSearch(ctx as BotContext, text);
    if (didInlineSearch) return;
  }

  if (existingState?.flow === "add") {
    const handled = await handleAddShopText(ctx as BotContext, existingState, text);
    if (handled) return;
  }

  if (existingState?.flow === "search") {
    const handled = await handleSearchText(ctx as BotContext, existingState, text);
    if (handled) return;
  }

  // Default fallback
  await ctx.reply('Use the menu, or send "City, ST" to search.', { reply_markup: mainMenuKeyboard() });
});

async function handleLastAdded(ctx: BotContext) {
  try {
    const shops = await getAllShops(ctx.kv);
    if (shops.length === 0) {
      await ctx.reply("No shops yet. Add one first!", { reply_markup: mainMenuKeyboard() });
      return;
    }
    const last = shops.slice(-10).reverse();
    const lines = last.map((s, i) => {
      const services = s.servicesCSV ? ` | Services: ${s.servicesCSV}` : "";
      return `${i + 1}) ${s.shopName} — ${s.city}, ${s.state} | Phone: ${s.phone}${services}`;
    });
    await ctx.reply(["Last 10 added:", "", ...lines].join("\n"), { reply_markup: mainMenuKeyboard() });
  } catch (e) {
    console.error("Last added error:", e);
    await ctx.reply("Error reading the sheet. Check logs.", { reply_markup: mainMenuKeyboard() });
  }
}

if (!isDeploy() && USE_POLLING) {
  console.log("Starting in polling mode (local dev)...");
  bot.start();
} else {
  const path = webhookPath();
  const secret = Deno.env.get("TELEGRAM_SECRET_TOKEN") ?? "";

  const handleUpdate = webhookCallback(bot, "std/http");

  console.log("Starting webhook server on Deno Deploy-compatible HTTP server.");
  console.log("Webhook path:", path);
  if (secret) console.log("Secret token header check enabled.");

  serve(async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname !== path) return new Response("Not found", { status: 404 });

    if (secret) {
      const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (got !== secret) return new Response("Unauthorized", { status: 401 });
    }

    try {
      return await handleUpdate(req);
    } catch (e) {
      console.error("Webhook handler error:", e);
      return new Response("Internal error", { status: 500 });
    }
  });
}
