import { corsHeaders, healthInfo, configInfo, createSessionHandler, prepareChat, runChat, sseLine } from '../../src/handlers.js';

/**
 * Netlify Function – celé API pod /api/*  (session, chat se streamingem, config, health).
 * Sessions jsou v Netlify Blobs (store "fami-sessions"), viz src/session-store.js.
 */
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });

export default async (req, context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const cors = corsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    if (route === 'health' && req.method === 'GET') return json(await healthInfo(), 200, cors);
    if (route === 'config' && req.method === 'GET') return json(configInfo(), 200, cors);

    if (route === 'session' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const meta = { ua: req.headers.get('user-agent'), origin: req.headers.get('origin'), page: body?.page };
      return json(await createSessionHandler(meta), 200, cors);
    }

    if (route === 'chat' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const meta = { ua: req.headers.get('user-agent'), origin: req.headers.get('origin') };
      const prep = await prepareChat({ sessionId: body?.sessionId, message: body?.message, meta });
      if (prep.error) return json({ error: prep.error }, prep.status, cors);
      const { session, text, store } = prep;

      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const emit = (event, data) => {
            try { controller.enqueue(enc.encode(sseLine(event, data))); } catch { /* klient odpojen */ }
          };
          emit('session', { sessionId: session.id });
          await runChat({ session, text, store, emit, ip: context.ip });
          try { controller.close(); } catch {}
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          ...cors,
        },
      });
    }

    return json({ error: 'Not found' }, 404, cors);
  } catch (err) {
    console.error('api error', err);
    return json({ error: 'Interní chyba serveru.' }, 500, cors);
  }
};

export const config = {
  path: '/api/*',
};
