// src/flows/addShop.ts
import type { Context } from "npm:grammy@1.21.1";
import { InlineKeyboard } from "npm:grammy@1.21.1";
import type { FlowState, ShopInput, StaffType, Service } from "../types.ts";
import { STAFF_TYPES, SERVICES } from "../types.ts";
import { setFlowState, clearFlowState } from "../kv.ts";
import { appendShopRow } from "../sheets.ts";
import { geocodeAddress } from "../geocode.ts";
import { mainMenuKeyboard, sendMainMenu } from "./menu.ts";

type BotContext = Context & { kv: Deno.Kv };

const CANCEL_CB = "add:cancel";

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✖ Cancel", CANCEL_CB);
}

function staffKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const t of STAFF_TYPES) {
    kb.text(t, `add:staff:${t}`);
    kb.row();
  }
  kb.row().text("✖ Cancel", CANCEL_CB);
  return kb;
}

function servicesKeyboard(selected: Service[]): InlineKeyboard {
  const selectedSet = new Set(selected);
  const kb = new InlineKeyboard();
  for (let i = 0; i < SERVICES.length; i++) {
    const s = SERVICES[i];
    const label = selectedSet.has(s) ? `✅ ${s}` : s;
    kb.text(label, `add:toggle_service:${s}`);
    if (i % 2 === 1) kb.row();
  }
  kb.row();
  kb.text("Done", "add:services_done").text("✖ Cancel", CANCEL_CB);
  return kb;
}

function confirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Save ✅", "add:confirm_save")
    .text("Edit ✏️", "add:confirm_edit")
    .row()
    .text("✖ Cancel", "add:confirm_cancel");
}

function editFieldsKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Shop Name", "add:edit_field:shopName")
    .row()
    .text("Address", "add:edit_field:address")
    .row()
    .text("City", "add:edit_field:city")
    .text("State", "add:edit_field:state")
    .row()
    .text("Phone", "add:edit_field:phone")
    .row()
    .text("Contact Person", "add:edit_field:contactPerson")
    .row()
    .text("Staff Type", "add:edit_field:staffType")
    .row()
    .text("Services", "add:edit_field:services")
    .row()
    .text("Notes", "add:edit_field:notes")
    .row()
    .text("Back", "add:edit_field:back")
    .text("✖ Cancel", CANCEL_CB);
  return kb;
}

function isValidState(s: string): boolean {
  return /^[A-Z]{2}$/.test(s);
}

function normalizeState(s: string): string {
  return s.trim().toUpperCase();
}

function requireChatUser(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) throw new Error("Missing chat/user");
  return { chatId, userId };
}

function formatSummary(data: Partial<ShopInput>, services: Service[]): string {
  return [
    "Please confirm:",
    "",
    `Shop Name: ${data.shopName ?? ""}`,
    `Address: ${data.address ?? ""}`,
    `City: ${data.city ?? ""}`,
    `State: ${data.state ?? ""}`,
    `Phone: ${data.phone ?? ""}`,
    `Contact Person: ${data.contactPerson ?? ""}`,
    `Staff Type: ${data.staffType ?? ""}`,
    `Services: ${(services ?? []).join(", ") || ""}`,
    `Notes: ${data.notes ?? ""}`,
  ].join("\n");
}

async function promptForStep(
  ctx: BotContext,
  state: FlowState & { flow: "add" },
) {
  switch (state.step) {
    case "shopName":
      await ctx.reply("Enter the shop name:", { reply_markup: cancelKeyboard() });
      break;
    case "address":
      await ctx.reply("Enter the full address (street + number, etc.):", {
        reply_markup: cancelKeyboard(),
      });
      break;
    case "city":
      await ctx.reply("Enter the city:", { reply_markup: cancelKeyboard() });
      break;
    case "state":
      await ctx.reply("Enter the state as 2-letter code (example: TX):", {
        reply_markup: cancelKeyboard(),
      });
      break;
    case "phone":
      await ctx.reply("Enter the phone number:", {
        reply_markup: cancelKeyboard(),
      });
      break;
    case "contactPerson":
      await ctx.reply("Enter the contact person name:", {
        reply_markup: cancelKeyboard(),
      });
      break;
    case "staffType":
      await ctx.reply("Choose staff type:", { reply_markup: staffKeyboard() });
      break;
    case "services":
      await ctx.reply("Select services (multi-select). Tap Done when finished:", {
        reply_markup: servicesKeyboard(state.servicesSelected),
      });
      break;
    case "notes":
      await ctx.reply("Any notes? (You can write anything. Send '-' for none.)", {
        reply_markup: cancelKeyboard(),
      });
      break;
    case "confirm":
      await ctx.reply(formatSummary(state.data, state.servicesSelected), {
        reply_markup: confirmKeyboard(),
      });
      break;
    case "editF
