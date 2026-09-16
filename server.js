import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, services, okresy, ROOT } from './src/config.js';
import { createSession, getSession, sessionCount } from './src/sessions.js';
import { runTurn } from './src/claude.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

// ---------- CORS (widget vložený na famicura.cz volá API cross-origin) ----------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Jednoduchý rate limit podle IP ----------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > config.rateLimitPerMin;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < 60_000)) hits.delete(ip);
}, 60_000).unref();

// ---------- Logování konverzací (JSONL, jeden soubor na den) ----------
function logTurn(rec) {
  if (!config.logConversations) return;
  try {
    fs.mkdirSync(config.logDir, { recursive: true });
    const file = path.join(config.logDir, `conversations-${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFile(file, JSON.stringify(rec) + '\n', () => {});
  } catch (e) {
    console.error('log error', e.message);
  }
}

// ---------- API ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: config.mock, model: config.model, sessions: sessionCount(), hasKey: Boolean(config.apiKey) });
});

/** Konfigurace pro widget: uvítací zpráva, seznam služeb a okresů (pro našeptávač / zobrazení). */
app.get('/api/config', (req, res) => {
  res.json({
    welcome: config.welcome,
    homeUrl: config.homeUrl,
    services: services.map(({ code, name, short, type }) => ({ code, name, short, type })),
    okresy,
    voice: true,
  });
});

app.post('/api/session', (req, res) => {
  const s = createSession({ ua: req.headers['user-agent'], origin: req.headers.origin, page: req.body?.page });
  res.json({ sessionId: s.id, welcome: config.welcome });
});

/**
 * POST /api/chat  { sessionId, message }
 * Odpověď: text/event-stream s událostmi:
 *   event: text            data: {"delta":"..."}
 *   event: recommendation  data: {"services":[{code,name,short,type,url}], "region":{id,name}|null}
 *   event: done            data: {"usage":{...}}
 *   event: error           data: {"message":"..."}
 */
app.post('/api/chat', async (req, res) => {
  const ip = req.ip;
  if (rateLimited(ip)) return res.status(429).json({ error: 'Příliš mnoho zpráv, zkuste to prosím za chvíli.' });

  const { sessionId, message } = req.body || {};
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return res.status(400).json({ error: 'Chybí text zprávy.' });
  if (text.length > config.maxUserChars) return res.status(400).json({ error: `Zpráva je příliš dlouhá (max ${config.maxUserChars} znaků).` });
  if (!config.mock && !config.apiKey) return res.status(500).json({ error: 'Server nemá nastavený ANTHROPIC_API_KEY.' });

  const session = getSession(sessionId) || createSession({ ua: req.headers['user-agent'], origin: req.headers.origin });
  if (session.busy) return res.status(409).json({ error: 'Předchozí zpráva se ještě zpracovává.' });
  session.busy = true;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: session\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);

  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);

  const started = Date.now();
  let recommendations = [];
  const emitWrapped = (event, data) => {
    if (event === 'recommendation') recommendations.push(data);
    emit(event, data);
  };

  try {
    const answer = await runTurn(session, text, emitWrapped);
    logTurn({ t: new Date().toISOString(), sessionId: session.id, ip, ms: Date.now() - started, user: text, assistant: answer, recommendations });
  } catch (err) {
    console.error('chat error', err);
    // Odebereme poslední user zprávu, aby se historie nerozbila (odpověď nepřišla).
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') session.messages.pop();
    emit('error', { message: friendlyError(err) });
  } finally {
    clearInterval(heartbeat);
    session.busy = false;
    if (!res.writableEnded) res.end();
  }
});

function friendlyError(err) {
  const status = err?.status;
  if (status === 401) return 'Neplatný API klíč.';
  if (status === 429) return 'Služba je momentálně přetížená, zkuste to prosím za chvíli.';
  if (status === 529 || status === 503) return 'Služba je dočasně nedostupná, zkuste to prosím za chvíli.';
  return 'Omlouvám se, došlo k chybě. Zkuste prosím zprávu poslat znovu.';
}

// ---------- Statické soubory (demo stránka + widget) ----------
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '5m', etag: true }));

app.listen(config.port, () => {
  console.log(`Fami chatbot běží na http://localhost:${config.port}  (mock=${config.mock}, model=${config.model})`);
  if (!config.mock && !config.apiKey) console.warn('POZOR: ANTHROPIC_API_KEY není nastaven.');
});
