import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Úložiště sessions (historie konverzace).
 *  - memory: pro Express server / lokální vývoj (jedna instance)
 *  - blobs:  pro Netlify Functions (každé volání běží zvlášť) – Netlify Blobs, store "fami-sessions"
 * Rozhraní: create(meta) → session, load(id) → session|null, save(session)
 * Session: { id, messages[], createdAt, lastAt, meta, lastRecommendation }
 */

const ttlMs = () => config.sessionTtlMin * 60 * 1000;

export function newSession(meta = {}) {
  return { id: crypto.randomUUID(), messages: [], createdAt: Date.now(), lastAt: Date.now(), meta, lastRecommendation: null };
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

// ---------- memory ----------
function memoryStore() {
  const map = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of map) if (now - s.lastAt > ttlMs()) map.delete(id);
  }, 60_000).unref?.();
  return {
    kind: 'memory',
    async create(meta) { const s = newSession(meta); map.set(s.id, s); return s; },
    async load(id) { const s = id && map.get(id); if (!s || Date.now() - s.lastAt > ttlMs()) return null; s.lastAt = Date.now(); return s; },
    async save(s) { s.lastAt = Date.now(); map.set(s.id, s); },
    size() { return map.size; },
  };
}

// ---------- Netlify Blobs ----------
async function blobsStore() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'fami-sessions', consistency: 'strong' });
  return {
    kind: 'blobs',
    async create(meta) { const s = newSession(meta); await store.setJSON(s.id, s); return s; },
    async load(id) {
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
      const s = await store.get(id, { type: 'json' });
      if (!s || Date.now() - s.lastAt > ttlMs()) return null;
      return s;
    },
    async save(s) { s.lastAt = Date.now(); await store.setJSON(s.id, s); },
    size() { return -1; },
  };
}

let storePromise = null;
export function getSessionStore() {
  if (!storePromise) {
    storePromise = (async () => {
      const onNetlify = typeof globalThis.Netlify !== 'undefined' || process.env.NETLIFY === 'true' || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
      const wantBlobs = config.sessionStore === 'blobs' || (config.sessionStore === 'auto' && onNetlify);
      if (wantBlobs) {
        try { return await blobsStore(); } catch (e) { console.warn('Netlify Blobs nedostupné, používám paměť:', e.message); }
      }
      return memoryStore();
    })();
  }
  return storePromise;
}
