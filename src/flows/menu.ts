// src/flows/menu.ts
import type { Context } from "npm:grammy@1.21.1";
import { InlineKeyboard } from "npm:grammy@1.21.1";

type BotContext = Context & { kv: Deno.Kv };

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Add shop", "menu:add")
    .row()
    .text("🔎 Search (100 miles)", "menu:search")
    .row()
    .text("📄 Last added", "menu:last")
    .row()
    .text("❓ Help", "menu:help");
}

export async function sendMainMenu(ctx: BotContext): Promise<void> {
  await ctx.reply("Main menu:", { reply_markup: mainMenuKeyboard() });
}
