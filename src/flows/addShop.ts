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
    case "editField":
      await ctx.reply("What do you want to edit?", {
        reply_markup: editFieldsKeyboard(),
      });
      break;
    default:
      await ctx.reply("Something went wrong. Returning to menu.");
      await clearFlowState(
        ctx.kv,
        requireChatUser(ctx).chatId,
        requireChatUser(ctx).userId,
      );
      await sendMainMenu(ctx);
  }
}

export async function startAddShop(ctx: BotContext): Promise<void> {
  const { chatId, userId } = requireChatUser(ctx);
  const state: FlowState = {
    flow: "add",
    step: "shopName",
    data: {},
    servicesSelected: [],
  };
  await setFlowState(ctx.kv, chatId, userId, state);
  await ctx.reply("Add a new shop (wizard). You can cancel anytime.", {
    reply_markup: cancelKeyboard(),
  });
  await promptForStep(ctx, state as FlowState & { flow: "add" });
}

export async function handleAddShopText(
  ctx: BotContext,
  state: FlowState & { flow: "add" },
  text: string,
): Promise<boolean> {
  const { chatId, userId } = requireChatUser(ctx);
  const t = text.trim();

  switch (state.step) {
    case "shopName":
      if (!t) {
        await ctx.reply("Shop name cannot be empty. Try again:", {
          reply_markup: cancelKeyboard(),
        });
        return true;
      }
      state.data.shopName = t;
      state.step = "address";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;

    case "address":
      if (!t) {
        await ctx.reply("Address cannot be empty. Try again:", {
          reply_markup: cancelKeyboard(),
        });
        return true;
      }
      state.data.address = t;
      state.step = "city";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;

    case "city":
      if (!t) {
        await ctx.reply("City cannot be empty. Try again:", {
          reply_markup: cancelKeyboard(),
        });
        return true;
      }
      state.data.city = t;
      state.step = "state";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;

    case "state": {
      const st = normalizeState(t);
      if (!isValidState(st)) {
        await ctx.reply("State must be 2 letters (example: TX). Try again:", {
          reply_markup: cancelKeyboard(),
        });
        return true;
      }
      state.data.state = st;
      state.step = "phone";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;
    }

    case "phone":
      if (!t) {
        await ctx.reply("Phone cannot be empty. Try again:", {
          reply_markup: cancelKeyboard(),
        });
        return true;
      }
      state.data.phone = t;
      state.step = "contactPerson";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;

    case "contactPerson":
      if (!t) {
        await ctx.reply("Contact person cannot be empty. Try again:", {
          reply_markup: cancelKeyboard(),
        });
        return true;
      }
      state.data.contactPerson = t;
      state.step = "staffType";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;

    case "notes":
      state.data.notes = t === "-" ? "" : t;
      state.step = "confirm";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return true;

    default:
      return false;
  }
}

async function finalizeAndSave(ctx: BotContext, state: FlowState & { flow: "add" }) {
  const { chatId, userId } = requireChatUser(ctx);

  const required: (keyof ShopInput)[] = [
    "shopName",
    "address",
    "city",
    "state",
    "phone",
    "contactPerson",
    "staffType",
  ];

  for (const k of required) {
    if (!state.data[k]) {
      await ctx.reply(`Missing required field: ${k}. Please edit and try again.`);
      state.step = "editField";
      await setFlowState(ctx.kv, chatId, userId, state);
      await promptForStep(ctx, state);
      return;
    }
  }

  if (state.servicesSelected.length === 0) {
    await ctx.reply(
      "No services selected. If that's correct, tap Save again. Or Edit to add services.",
    );
    return;
  }

  const createdAtISO = new Date().toISOString();

  const fullGeocodeQuery = `${state.data.address}, ${state.data.city}, ${state.data.state}`;
  let lat = "";
  let lng = "";
  let notes = state.data.notes ?? "";

  try {
    const geo = await geocodeAddress(ctx.kv, fullGeocodeQuery);
    if (geo) {
      lat = String(geo.lat);
      lng = String(geo.lng);
    } else {
      const warn = "WARNING: Geocoding failed; lat/lng left empty.";
      notes = notes ? `${notes} | ${warn}` : warn;
    }
  } catch (e) {
    const warn = `WARNING: Geocoding error; lat/lng left empty. (${String(e)})`;
    notes = notes ? `${notes} | ${warn}` : warn;
  }

  const row: string[] = [
    createdAtISO,
    state.data.shopName!,
    state.data.address!,
    state.data.city!,
    state.data.state!,
    state.data.phone!,
    state.data.contactPerson!,
    state.data.staffType as string,
    state.servicesSelected.join(", "),
    notes,
    lat,
    lng,
  ];

  await appendShopRow(ctx.kv, row);

  await clearFlowState(ctx.kv, chatId, userId);

  await ctx.reply("✅ Saved to Google Sheets.");
  await ctx.reply("Main menu:", { reply_markup: mainMenuKeyboard() });
}

export async function handleAddShopCallback(
  ctx: BotContext,
  state: FlowState & { flow: "add" },
  data: string,
): Promise<boolean> {
  const { chatId, userId } = requireChatUser(ctx);

  if (data === CANCEL_CB || data === "add:confirm_cancel") {
    await clearFlowState(ctx.kv, chatId, userId);
    await ctx.answerCallbackQuery();
    await ctx.reply("Cancelled. Main menu:", { reply_markup: mainMenuKeyboard() });
    return true;
  }

  if (data.startsWith("add:staff:")) {
    const staff = data.replace("add:staff:", "") as StaffType;
    state.data.staffType = staff;
    state.step = "services";
    await setFlowState(ctx.kv, chatId, userId, state);
    await ctx.answerCallbackQuery();
    await promptForStep(ctx, state);
    return true;
  }

  if (data.startsWith("add:toggle_service:")) {
    const svc = data.replace("add:toggle_service:", "") as Service;
    const set = new Set(state.servicesSelected);
    if (set.has(svc)) set.delete(svc);
    else set.add(svc);
    state.servicesSelected = Array.from(set);
    await setFlowState(ctx.kv, chatId, userId, state);
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: servicesKeyboard(state.servicesSelected),
      });
    } catch {
      // ignore
    }
    return true;
  }

  if (data === "add:services_done") {
    if (state.servicesSelected.length === 0) {
      await ctx.answerCallbackQuery({ text: "Select at least one service (or choose Other)." });
      return true;
    }
    state.step = "notes";
    await setFlowState(ctx.kv, chatId, userId, state);
    await ctx.answerCallbackQuery();
    await promptForStep(ctx, state);
    return true;
  }

  if (data === "add:confirm_edit") {
    state.step = "editField";
    await setFlowState(ctx.kv, chatId, userId, state);
    await ctx.answerCallbackQuery();
    await promptForStep(ctx, state);
    return true;
  }

  if (data === "add:confirm_save") {
    await ctx.answerCallbackQuery();
    await finalizeAndSave(ctx, state);
    return true;
  }

  if (data.startsWith("add:edit_field:")) {
    const field = data.replace("add:edit_field:", "");

    if (field === "back") {
      state.step = "confirm";
      await setFlowState(ctx.kv, chatId, userId, state);
      await ctx.answerCallbackQuery();
      await promptForStep(ctx, state);
      return true;
    }

    await ctx.answerCallbackQuery();

    switch (field) {
      case "shopName":
      case "address":
      case "city":
      case "state":
      case "phone":
      case "contactPerson":
      case "notes":
        state.step = field as any;
        await setFlowState(ctx.kv, chatId, userId, state);
        await promptForStep(ctx, state);
        return true;
      case "staffType":
        state.step = "staffType";
        await setFlowState(ctx.kv, chatId, userId, state);
        await promptForStep(ctx, state);
        return true;
      case "services":
        state.step = "services";
        await setFlowState(ctx.kv, chatId, userId, state);
        await promptForStep(ctx, state);
        return true;
      default:
        return false;
    }
  }

  return false;
}
