// src/kv.ts
import type { FlowState } from "./types.ts";

export async function openKv(): Promise<Deno.Kv> {
  return await Deno.openKv();
}

function stateKey(chatId: number, userId: number) {
  return ["state", chatId, userId] as const;
}

export async function getFlowState(
  kv: Deno.Kv,
  chatId: number,
  userId: number,
): Promise<FlowState | null> {
  const res = await kv.get<FlowState>(stateKey(chatId, userId));
  return res.value ?? null;
}

export async function setFlowState(
  kv: Deno.Kv,
  chatId: number,
  userId: number,
  state: FlowState,
  ttlMs = 24 * 60 * 60 * 1000,
): Promise<void> {
  await kv.set(stateKey(chatId, userId), state, { expireIn: ttlMs });
}

export async function clearFlowState(
  kv: Deno.Kv,
  chatId: number,
  userId: number,
): Promise<void> {
  await kv.delete(stateKey(chatId, userId));
}

// Generic KV cache helpers (TTL-based)
export async function getCache<T>(
  kv: Deno.Kv,
  key: Deno.KvKey,
): Promise<T | null> {
  const res = await kv.get<T>(key);
  return res.value ?? null;
}

export async function setCache<T>(
  kv: Deno.Kv,
  key: Deno.KvKey,
  value: T,
  ttlMs: number,
): Promise<void> {
  await kv.set(key, value, { expireIn: ttlMs });
}

export async function delCache(kv: Deno.Kv, key: Deno.KvKey): Promise<void> {
  await kv.delete(key);
}
