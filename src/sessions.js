import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Jednoduché in-memory sessions (historie konverzace na serveru).
 * Klient posílá jen sessionId + novou zprávu. Při restartu serveru se sessions ztratí –
 * pro produkci s více instancemi nahradit Redis/SQL (rozhraní get/create/touch zůstává).
 */
const sessions = new Map();

export function createSession(meta = {}) {
  const id = crypto.randomUUID();
  const s = { id, messages: [], createdAt: Date.now(), lastAt: Date.now(), meta, busy: false };
  sessions.set(id, s);
  return s;
}

export function getSession(id) {
  const s = id && sessions.get(id);
  if (!s) return null;
  s.lastAt = Date.now();
  return s;
}

export function trimHistory(session) {
  // Držíme posledních N zpráv; historie musí začínat user zprávou a nesmí rozseknout tool_use/tool_result pár.
  const max = config.maxHistoryMessages;
  if (session.messages.length <= max) return;
  let cut = session.messages.length - max;
  while (cut < session.messages.length) {
    const m = session.messages[cut];
    const isToolResult = m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result');
    if (m.role === 'user' && !isToolResult) break;
    cut++;
  }
  session.messages = session.messages.slice(cut);
}

setInterval(() => {
  const ttl = config.sessionTtlMin * 60 * 1000;
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastAt > ttl) sessions.delete(id);
}, 60 * 1000).unref();

export const sessionCount = () => sessions.size;
