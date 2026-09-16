import { config, services, okresy } from './config.js';
import { getSessionStore } from './session-store.js';
import { runTurn } from './claude.js';

/** Logika API nezávislá na frameworku – používá ji Express server i Netlify Function. */

export function corsHeaders(origin) {
  if (!origin) return {};
  if (!(config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function healthInfo() {
  const store = await getSessionStore();
  return { ok: true, mock: config.mock, model: config.model, sessionStore: store.kind, sessions: store.size(), hasKey: Boolean(config.apiKey) };
}

export function configInfo() {
  return {
    welcome: config.welcome,
    homeUrl: config.homeUrl,
    services: services.map(({ code, name, short, type }) => ({ code, name, short, type })),
    okresy,
    voice: true,
  };
}

export async function createSessionHandler(meta) {
  const store = await getSessionStore();
  const s = await store.create(meta);
  return { sessionId: s.id, welcome: config.welcome };
}

/**
 * Zvaliduje požadavek na chat a vrátí { error, status } nebo { session, text }.
 */
export async function prepareChat({ sessionId, message, meta }) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return { status: 400, error: 'Chybí text zprávy.' };
  if (text.length > config.maxUserChars) return { status: 400, error: `Zpráva je příliš dlouhá (max ${config.maxUserChars} znaků).` };
  if (!config.mock && !config.apiKey) return { status: 500, error: 'Server nemá nastavený ANTHROPIC_API_KEY.' };
  const store = await getSessionStore();
  const session = (await store.load(sessionId)) || (await store.create(meta));
  return { session, text, store };
}

/**
 * Provede kolo konverzace, uloží session a zaloguje. emit(event, data) posílá SSE události.
 */
export async function runChat({ session, text, store, emit, ip }) {
  const started = Date.now();
  const recommendations = [];
  const emitWrapped = (event, data) => {
    if (event === 'recommendation') recommendations.push(data);
    emit(event, data);
  };
  try {
    const answer = await runTurn(session, text, emitWrapped);
    await store.save(session);
    if (config.logConversations) {
      console.log(JSON.stringify({ t: new Date().toISOString(), sessionId: session.id, ip, ms: Date.now() - started, user: text, assistant: answer, recommendations }));
    }
    return answer;
  } catch (err) {
    console.error('chat error', err);
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') session.messages.pop();
    await store.save(session).catch(() => {});
    emit('error', { message: friendlyError(err) });
    return null;
  }
}

export function friendlyError(err) {
  const status = err?.status;
  if (status === 401) return 'Neplatný API klíč.';
  if (status === 429) return 'Služba je momentálně přetížená, zkuste to prosím za chvíli.';
  if (status === 529 || status === 503) return 'Služba je dočasně nedostupná, zkuste to prosím za chvíli.';
  return 'Omlouvám se, došlo k chybě. Zkuste prosím zprávu poslat znovu.';
}

export const sseLine = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
