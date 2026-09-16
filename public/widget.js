/*!
 * Fami – chatovací widget pro www.famicura.cz
 * Vložení:  <script src="https://<server>/widget.js" data-api-base="https://<server>" defer></script>
 * Volitelné data-atributy: data-mode="floating|inline"  data-container="#id" (pro inline)
 *   data-title="Fami"  data-color="#2b5bd7"  data-open="true"  data-voice="true|false"
 * Nebo window.FamiConfig = { apiBase, mode, container, title, color, open, voice }
 * Události pro hostitelskou stránku: window.addEventListener('fami:recommendation', e => e.detail)
 */
(function () {
  'use strict';
  if (window.__famiWidgetLoaded) return;
  window.__famiWidgetLoaded = true;

  const script = document.currentScript;
  const ds = (script && script.dataset) || {};
  const cfg = Object.assign(
    {
      apiBase: ds.apiBase || (script ? new URL(script.src, location.href).origin : ''),
      mode: ds.mode || 'floating',
      container: ds.container || null,
      title: ds.title || 'Fami',
      subtitle: ds.subtitle || 'asistentka FamiCura',
      color: ds.color || '#2b5bd7',
      open: ds.open === 'true',
      voice: ds.voice !== 'false',
      page: location.href,
    },
    window.FamiConfig || {}
  );
  cfg.apiBase = cfg.apiBase.replace(/\/$/, '');

  // ---------- Pomocné ----------
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem('fami:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem('fami:' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { sessionStorage.removeItem('fami:' + k); } catch {} },
  };
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('fami:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fami:' + k, JSON.stringify(v)); } catch {} },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderText(t) {
    // prostý text → odstavce + odkazy na famicura.cz (prompt zakazuje markdown, takže žádný parser)
    let h = esc(t);
    h = h.replace(/(https?:\/\/[^\s<]+|www\.[a-z0-9.-]+\.[a-z]{2,}[^\s<]*)/gi, (m) => {
      const href = m.startsWith('http') ? m : 'https://' + m;
      return `<a href="${href}" target="_blank" rel="noopener">${m}</a>`;
    });
    return h.replace(/\n/g, '<br>');
  }

  // ---------- Styly ----------
  const css = `
  :host{all:initial;display:block}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .fab{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;background:var(--c);color:#fff;border:0;
    box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s}
  .fab:hover{transform:scale(1.06)} .fab svg{width:28px;height:28px}
  .fab .badge{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #fff}
  .panel{position:fixed;right:20px;bottom:92px;width:min(400px,calc(100vw - 24px));height:min(640px,calc(100vh - 110px));background:#fff;border-radius:18px;
    box-shadow:0 16px 48px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;opacity:0;transform:translateY(12px);
    pointer-events:none;transition:opacity .18s,transform .18s}
  .panel.open{opacity:1;transform:none;pointer-events:auto}
  .panel.inline{position:static;width:100%;height:100%;box-shadow:none;border-radius:0;opacity:1;transform:none;pointer-events:auto}
  @media (max-width:480px){.panel:not(.inline){right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}.fab{right:14px;bottom:14px}}
  .hdr{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--c);color:#fff;flex:0 0 auto}
  .hdr .av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700}
  .hdr .t{flex:1;min-width:0}.hdr .t b{display:block;font-size:15px}.hdr .t span{display:block;font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ib{background:transparent;border:0;color:#fff;width:34px;height:34px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:.9}
  .ib:hover{background:rgba(255,255,255,.15)} .ib.on{background:rgba(255,255,255,.28)} .ib svg{width:20px;height:20px} .ib[disabled]{opacity:.35;cursor:default}
  .msgs{flex:1;overflow-y:auto;padding:14px;background:#f5f7fb;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
  .m{max-width:88%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.45;white-space:normal;word-wrap:break-word}
  .m.a{background:#fff;color:#1c2333;border-bottom-left-radius:4px;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,.06)}
  .m.u{background:var(--c);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
  .m a{color:inherit;text-decoration:underline}
  .m.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;align-self:center;font-size:13px}
  .typing{align-self:flex-start;background:#fff;border-radius:14px;padding:10px 14px;display:flex;gap:4px}
  .typing i{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:b 1.2s infinite}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
  @keyframes b{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
  .card{align-self:stretch;background:#fff;border:1px solid #dbe3f0;border-left:4px solid var(--c);border-radius:12px;padding:12px 14px;font-size:14px;color:#1c2333}
  .card h4{margin:0 0 2px;font-size:14px;font-weight:700}.card .rg{font-size:12.5px;color:#475569;margin-bottom:8px}
  .card ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
  .card li{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:#f8fafc;border-radius:8px}
  .card li .n{flex:1;min-width:0}.card li .n b{display:block;font-size:13.5px}.card li .n small{display:block;color:#64748b;font-size:12px;margin-top:2px}
  .card li a{flex:0 0 auto;background:var(--c);color:#fff;text-decoration:none;font-size:12.5px;padding:7px 10px;border-radius:8px;white-space:nowrap}
  .card .foot{margin-top:8px;font-size:12px;color:#64748b}.card .foot a{color:var(--c)}
  .inp{flex:0 0 auto;border-top:1px solid #e5e9f2;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff}
  textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;font-size:14.5px;line-height:1.35;max-height:120px;outline:none;font-family:inherit}
  textarea:focus{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
  .sb{width:42px;height:42px;border-radius:12px;border:0;background:var(--c);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .sb[disabled]{opacity:.45;cursor:default}.sb svg{width:20px;height:20px}
  .mic{background:#eef2ff;color:var(--c)}.mic.rec{background:#ef4444;color:#fff;animation:p 1s infinite}
  @keyframes p{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}
  .foot{font-size:11px;color:#94a3b8;text-align:center;padding:4px 10px 8px;background:#fff}.foot a{color:#94a3b8}
  .hint{font-size:12px;color:#64748b;text-align:center;padding:2px 0 0}
  `;

  const ICON = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>',
    spk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>',
    spkOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  };

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.id = 'fami-widget';
  if (cfg.mode === 'inline') host.style.cssText = 'display:block;height:100%;min-height:420px';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);
  const wrap = document.createElement('div');
  wrap.style.setProperty('--c', cfg.color);
  if (cfg.mode === 'inline') wrap.style.height = '100%';
  root.appendChild(wrap);

  const inline = cfg.mode === 'inline';
  let fab = null;
  if (!inline) {
    fab = document.createElement('button');
    fab.className = 'fab';
    fab.setAttribute('aria-label', 'Otevřít asistentku Fami');
    fab.innerHTML = ICON.chat + '<span class="badge"></span>';
    wrap.appendChild(fab);
  }

  const panel = document.createElement('div');
  panel.className = 'panel' + (inline ? ' inline' : '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat s asistentkou Fami');
  panel.innerHTML = `
    <div class="hdr">
      <div class="av">F</div>
      <div class="t"><b>${esc(cfg.title)}</b><span>${esc(cfg.subtitle)}</span></div>
      <button class="ib" data-a="spk" title="Předčítat odpovědi">${ICON.spk}</button>
      <button class="ib" data-a="reset" title="Nová konverzace">${ICON.reset}</button>
      ${inline ? '' : `<button class="ib" data-a="close" title="Zavřít">${ICON.close}</button>`}
    </div>
    <div class="msgs" aria-live="polite"></div>
    <div class="inp">
      <button class="sb mic" data-a="mic" title="Mluvit (hlasový vstup)">${ICON.mic}</button>
      <textarea rows="1" placeholder="Napište, s čím potřebujete pomoci…" aria-label="Vaše zpráva"></textarea>
      <button class="sb" data-a="send" title="Odeslat">${ICON.send}</button>
    </div>
    <div class="foot">Fami je AI asistentka – neposkytuje lékařskou diagnózu. <a href="${esc(cfg.apiBase ? 'https://www.famicura.cz' : '#')}" target="_blank" rel="noopener">famicura.cz</a></div>`;
  wrap.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const msgs = $('.msgs');
  const ta = $('textarea');
  const btnSend = $('[data-a=send]');
  const btnMic = $('[data-a=mic]');
  const btnSpk = $('[data-a=spk]');
  const btnReset = $('[data-a=reset]');
  const btnClose = $('[data-a=close]');

  if (inline) {
    const c = cfg.container ? document.querySelector(cfg.container) : null;
    (c || document.body).appendChild(host);
  } else {
    document.body.appendChild(host);
  }

  // ---------- Stav ----------
  let sessionId = store.get('sessionId', null);
  let history = store.get('history', []); // [{role:'a'|'u', text} | {role:'card', data}]
  let busy = false;
  let opened = inline || cfg.open;
  let speakOn = pref.get('speak', false);
  let welcome = '';

  function persist() { store.set('sessionId', sessionId); store.set('history', history.slice(-60)); }

  // ---------- Vykreslení ----------
  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function addBubble(role, text) {
    const d = document.createElement('div');
    d.className = 'm ' + (role === 'u' ? 'u' : role === 'err' ? 'err' : 'a');
    d.innerHTML = renderText(text);
    msgs.appendChild(d);
    scroll();
    return d;
  }
  function addCard(data) {
    const d = document.createElement('div');
    d.className = 'card';
    const region = data.region ? `Okres: <b>${esc(data.region.name)}</b>` : 'Okres zatím není zadán – po jeho doplnění nabídku upřesním.';
    d.innerHTML = `<h4>Doporučené služby</h4><div class="rg">${region}</div><ol>${data.services
      .map((s) => `<li><div class="n"><b>${esc(s.name)}</b><small>${esc(s.short || '')}</small></div>${data.region ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Najít poskytovatele</a>` : ''}</li>`)
      .join('')}</ol><div class="foot">Poskytovatele vyberete na <a href="https://www.famicura.cz" target="_blank" rel="noopener">www.famicura.cz</a>.</div>`;
    msgs.appendChild(d);
    scroll();
    return d;
  }
  function showTyping() {
    const d = document.createElement('div');
    d.className = 'typing';
    d.innerHTML = '<i></i><i></i><i></i>';
    msgs.appendChild(d);
    scroll();
    return d;
  }
  function renderHistory() {
    msgs.innerHTML = '';
    for (const h of history) {
      if (h.role === 'card') addCard(h.data);
      else addBubble(h.role, h.text);
    }
  }

  // ---------- Hlas: TTS ----------
  const synth = window.speechSynthesis;
  let czVoice = null;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    czVoice = vs.find((v) => /^cs/i.test(v.lang) && /Zuzana|Google|Natural|Premium/i.test(v.name)) || vs.find((v) => /^cs/i.test(v.lang)) || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!speakOn || !synth || !text) return;
    synth.cancel();
    const clean = text.replace(/https?:\/\/\S+|www\.\S+/g, 'famicura cé zet');
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'cs-CZ';
    if (czVoice) u.voice = czVoice;
    u.rate = 1.0;
    synth.speak(u);
  }
  function updateSpk() {
    btnSpk.classList.toggle('on', speakOn);
    btnSpk.innerHTML = speakOn ? ICON.spk : ICON.spkOff;
    btnSpk.title = speakOn ? 'Předčítání zapnuto' : 'Předčítání vypnuto';
  }
  if (!synth || !cfg.voice) btnSpk.style.display = 'none';
  updateSpk();
  btnSpk.addEventListener('click', () => { speakOn = !speakOn; pref.set('speak', speakOn); updateSpk(); if (!speakOn) synth.cancel(); });

  // ---------- Hlas: STT ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let recActive = false;
  if (!SR || !cfg.voice) btnMic.style.display = 'none';
  function startRec() {
    if (!SR || busy) return;
    if (synth) synth.cancel();
    rec = new SR();
    rec.lang = 'cs-CZ';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      ta.value = finalText || interim;
      autosize();
    };
    rec.onerror = (e) => { stopRec(); if (e.error === 'not-allowed') addBubble('err', 'Přístup k mikrofonu byl zamítnut. Povolte jej v nastavení prohlížeče.'); };
    rec.onend = () => {
      const wasActive = recActive;
      stopRec();
      if (wasActive && finalText.trim()) send(finalText.trim());
    };
    recActive = true;
    btnMic.classList.add('rec');
    btnMic.title = 'Nahrávám… klikněte pro ukončení';
    try { rec.start(); } catch { stopRec(); }
  }
  function stopRec() {
    recActive = false;
    btnMic.classList.remove('rec');
    btnMic.title = 'Mluvit (hlasový vstup)';
    if (rec) { try { rec.stop(); } catch {} }
  }
  btnMic.addEventListener('click', () => (recActive ? rec && rec.stop() : startRec()));

  // ---------- Komunikace ----------
  async function api(path, opts) {
    const r = await fetch(cfg.apiBase + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    return r;
  }

  async function ensureSession() {
    if (sessionId) return;
    try {
      const r = await api('/api/session', { method: 'POST', body: JSON.stringify({ page: cfg.page }) });
      const j = await r.json();
      sessionId = j.sessionId;
      welcome = j.welcome || '';
    } catch {}
    if (!history.length && welcome) {
      history.push({ role: 'a', text: welcome });
      addBubble('a', welcome);
    }
    persist();
  }

  async function send(text) {
    text = (text || ta.value).trim();
    if (!text || busy) return;
    if (synth) synth.cancel();
    busy = true;
    btnSend.disabled = true;
    btnMic.disabled = true;
    ta.value = '';
    autosize();
    history.push({ role: 'u', text });
    addBubble('u', text);
    persist();
    const typing = showTyping();
    let bubble = null;
    let full = '';

    try {
      const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, message: text }) });
      if (!r.ok || !r.body) {
        let msg = 'Omlouvám se, došlo k chybě. Zkuste to prosím znovu.';
        try { msg = (await r.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const clearTyping = () => panel.querySelectorAll('.typing').forEach((n) => n.remove());
      const handle = (ev, data) => {
        if (ev === 'session') { if (data.sessionId && data.sessionId !== sessionId) { sessionId = data.sessionId; persist(); } }
        else if (ev === 'text') {
          if (!bubble) { clearTyping(); bubble = addBubble('a', ''); }
          full += data.delta;
          bubble.innerHTML = renderText(full);
          scroll();
        } else if (ev === 'recommendation') {
          clearTyping();
          addCard(data);
          history.push({ role: 'card', data });
          if (!bubble) showTyping(); // text obvykle teprve přijde
          try { window.dispatchEvent(new CustomEvent('fami:recommendation', { detail: data })); } catch {}
        } else if (ev === 'error') {
          throw new Error(data.message || 'Chyba');
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let ev = 'message';
          let data = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }
          handle(ev, parsed);
        }
      }
      clearTyping();
      if (full) { history.push({ role: 'a', text: full }); persist(); speak(full); }
    } catch (e) {
      panel.querySelectorAll('.typing').forEach((n) => n.remove());
      addBubble('err', e.message || 'Omlouvám se, došlo k chybě.');
    } finally {
      busy = false;
      btnSend.disabled = false;
      btnMic.disabled = false;
      if (opened) ta.focus();
    }
  }

  function reset() {
    if (synth) synth.cancel();
    sessionId = null;
    history = [];
    welcome = '';
    store.del('sessionId'); store.del('history');
    msgs.innerHTML = '';
    ensureSession();
  }

  // ---------- Události UI ----------
  function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  btnSend.addEventListener('click', () => send());
  btnReset.addEventListener('click', reset);
  function setOpen(v) {
    opened = v;
    panel.classList.toggle('open', v);
    if (fab) { fab.innerHTML = (v ? ICON.close : ICON.chat + '<span class="badge"></span>'); fab.setAttribute('aria-label', v ? 'Zavřít asistentku' : 'Otevřít asistentku Fami'); }
    if (v) { ensureSession(); setTimeout(() => ta.focus(), 200); scroll(); } else if (synth) synth.cancel();
    pref.set('open', v);
  }
  if (fab) fab.addEventListener('click', () => setOpen(!opened));
  if (btnClose) btnClose.addEventListener('click', () => setOpen(false));

  // ---------- Start ----------
  renderHistory();
  if (inline) { ensureSession(); }
  else if (cfg.open || pref.get('open', false)) setOpen(true);

  // Veřejné API pro hostitelskou stránku
  window.Fami = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    send: (t) => { setOpen(true); send(t); },
    reset,
    get sessionId() { return sessionId; },
  };
})();
