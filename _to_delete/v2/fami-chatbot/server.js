import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './src/config.js';
import { corsHeaders, healthInfo, configInfo, createSessionHandler, prepareChat, runChat, sseLine } from './src/handlers.js';

/**
 * Express varianta (VPS / Docker). Stejná logika běží i jako Netlify Function (netlify/functions/api.mjs).
 */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

// ---------- CORS (widget vložený na famicura.cz volá API cross-origin) ----------
app.use((req, res, next) => {
  const h = corsHeaders(req.headers.origin);
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
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

// ---------- Logování konverzací do souboru (JSONL, jeden soubor na den) ----------
function logToFile(rec) {
  try {
    fs.mkdirSync(config.logDir, { recursive: true });
    const file = path.join(config.logDir, `conversations-${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFile(file, JSON.stringify(rec) + '\n', () => {});
  } catch (e) {
    console.error('log error', e.message);
  }
}

// ---------- API ----------
app.get('/api/health', async (req, res) => res.json(await healthInfo()));
app.get('/api/config', (req, res) => res.json(configInfo()));

app.post('/api/session', async (req, res) => {
  res.json(await createSessionHandler({ ua: req.headers['user-agent'], origin: req.headers.origin, page: req.body?.page }));
});

/**
 * POST /api/chat  { sessionId, message }
 * Odpověď: text/event-stream s událostmi session, text {delta}, recommendation {services, region}, done {usage}, error {message}
 */
app.post('/api/chat', async (req, res) => {
  const ip = req.ip;
  if (rateLimited(ip)) return res.status(429).json({ error: 'Příliš mnoho zpráv, zkuste to prosím za chvíli.' });

  const prep = await prepareChat({ sessionId: req.body?.sessionId, message: req.body?.message, meta: { ua: req.headers['user-agent'], origin: req.headers.origin } });
  if (prep.error) return res.status(prep.status).json({ error: prep.error });
  const { session, text, store } = prep;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event, data) => { if (!res.writableEnded) res.write(sseLine(event, data)); };
  emit('session', { sessionId: session.id });
  const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);

  const started = Date.now();
  const recs = [];
  const answer = await runChat({ session, text, store, ip, emit: (e, d) => { if (e === 'recommendation') recs.push(d); emit(e, d); } });
  if (answer != null && config.logConversations) logToFile({ t: new Date().toISOString(), sessionId: session.id, ip, ms: Date.now() - started, user: text, assistant: answer, recommendations: recs });

  clearInterval(heartbeat);
  if (!res.writableEnded) res.end();
});

// ---------- Statické soubory (demo stránka + widget) ----------
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '5m', etag: true }));

app.listen(config.port, () => {
  console.log(`Fami chatbot běží na http://localhost:${config.port}  (mock=${config.mock}, model=${config.model})`);
  if (!config.mock && !config.apiKey) console.warn('POZOR: ANTHROPIC_API_KEY není nastaven.');
});
