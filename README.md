# Fami – AI asistentka pro www.famicura.cz

Samostatná chatbot aplikace (Node.js + Claude API) s embeddovatelným widgetem. Nahrazuje / doplňuje
stávající asistentku Fami (v62, prompt 3.6) vlastním kódem, který máte plně pod kontrolou.

```
┌──────────────────────┐   SSE stream    ┌──────────────────────┐   tool use    ┌───────────────┐
│ famicura.cz          │ ──────────────▶ │ fami-chatbot         │ ────────────▶ │ Claude API    │
│  <script widget.js>  │ ◀────────────── │ Express, /api/chat   │ ◀──────────── │ (Sonnet 5)    │
│  karta doporučení    │  text + karta   │ sessions, log JSONL  │  recommended- │               │
└──────────────────────┘                 └──────────────────────┘   services    └───────────────┘
```

## Co umí

- **Text + hlas**: psaní, hlasový vstup (Web Speech API, cs-CZ) a předčítání odpovědí (speechSynthesis) – stejný režim
  „Text + audio + hlas“ jako původní asistentka. Hlas běží v prohlížeči, bez dalších nákladů.
- **Function call `recommended-services`**: model ho volá podle promptu (i bez okresu, po doplnění okresu znovu).
  Server zvaliduje kódy služeb a okres, doplní názvy a URL, a widgetu pošle událost `recommendation` –
  ta se vykreslí jako **karta „Doporučené služby“** s tlačítky *Najít poskytovatele*. Kódy se nikdy neukazují klientovi.
- **Streaming** odpovědí (SSE), historie konverzace na serveru (session), obnova chatu po reloadu stránky.
- **Prompt caching** – dlouhý systémový prompt (~27 000 tokenů) se cachuje, výrazně levnější a rychlejší provoz.
- **Bezpečnost**: CORS allowlist, rate limit na IP, limit délky zprávy, API klíč jen na serveru.
- **Logování konverzací** do `logs/conversations-YYYY-MM-DD.jsonl` (dotaz, odpověď, doporučení, doba odezvy).
- **Mock režim** pro vývoj bez API klíče (`MOCK=1`).

## Struktura

```
server.js                 Express server, /api/session, /api/chat (SSE), /api/config, /api/health, statické soubory
src/config.js             načtení .env + config/*.json, sestavení URL poskytovatelů
src/prompt.js             načtení prompt/system-prompt.md, doplnění okresů, cache_control
src/tools.js              definice nástroje recommended-services + validace/obohacení výstupu
src/claude.js             volání Claude API se streamingem a smyčkou tool_use → tool_result
src/session-store.js      úložiště sessions: paměť (Express) nebo Netlify Blobs (Netlify Functions)
src/handlers.js           logika API společná pro Express i Netlify Function
netlify/functions/api.mjs Netlify Function – celé API pod /api/* (streaming)
netlify.toml              konfigurace Netlify (publish public/, funkce, included_files)
src/mock.js               simulace odpovědí bez API
prompt/system-prompt.md   SYSTÉMOVÝ PROMPT (upravujte zde; {{OKRESY}} se doplní z configu)
config/services.json      kódy služeb (ID01…ID20), názvy, krátké popisy
config/okresy.json        okresy (id, název) – jediný zdroj pro prompt i schéma nástroje
public/widget.js          embeddovatelný widget (plovoucí bublina nebo inline)
public/index.html         samostatná stránka chatu (ekvivalent famicura.cz/asistent)
public/demo-embed.html    ukázka vložení na běžný web + JS API
deploy/                   Dockerfile, pm2, Caddy, VPS skript, Netlify
test/                     unit testy (tool loop, validace) a e2e test (Playwright)
```

## Spuštění lokálně

```bash
npm install
cp .env.example .env        # doplňte ANTHROPIC_API_KEY
npm start                   # http://localhost:3000
npm run mock                # bez API klíče – simulované odpovědi
npm test                    # unit testy
```

Otevřete `http://localhost:3000/` (samostatný chat) nebo `http://localhost:3000/demo-embed.html` (plovoucí widget).

## Vložení na famicura.cz

Jeden řádek před `</body>` (API server musí mít v `ALLOWED_ORIGINS` doménu webu):

```html
<script src="https://faminew.netlify.app/widget.js" data-api-base="https://faminew.netlify.app" defer></script>
```

Volitelné atributy: `data-color="#2b5bd7"`, `data-title="Fami"`, `data-subtitle="asistentka FamiCura"`,
`data-open="true"` (otevřít hned), `data-voice="false"` (bez hlasu), `data-mode="inline" data-container="#chat"`
(chat vložený do prvku místo plovoucí bubliny – takto je udělaná `index.html`).

JavaScript API stránky:

```js
Fami.open(); Fami.close(); Fami.reset();
Fami.send('Bolí mě koleno');                       // odešle zprávu (např. z tlačítka „Hledám řešení“)
window.addEventListener('fami:recommendation', e => {
  // e.detail = { services:[{code,name,short,type,url}], region:{id,name}|null }
  // → web famicura.cz může sám přesměrovat do vlastního vyhledávání poskytovatelů
});
```

Tlačítka „Najít poskytovatele“ v kartě vedou na `FAMICURA_PROVIDER_URL` (šablona s `{serviceCode}`, `{regionId}`,
`{regionName}`). **Skutečnou URL vyhledávání na famicura.cz je třeba doplnit** – viz Předpoklady níže.

## API

| Metoda | Cesta | Popis |
|---|---|---|
| POST | `/api/session` | založí session → `{ sessionId, welcome }` |
| POST | `/api/chat` | `{ sessionId, message }` → SSE: `session`, `text {delta}`, `recommendation {services, region}`, `done {usage}`, `error {message}` |
| GET | `/api/config` | uvítání, seznam služeb a okresů |
| GET | `/api/health` | stav serveru |

## Nasazení

**VPS (alternativa – stejně jako jhn-apps: pm2 + Caddy):**

```bash
# na serveru jednou
sudo mkdir -p /opt/fami-chatbot && sudo chown $USER /opt/fami-chatbot
# z Macu
HOST=jhnapps@95.216.201.2 ./deploy/vps-deploy.sh
# na serveru: /opt/fami-chatbot/.env (ANTHROPIC_API_KEY, ALLOWED_ORIGINS, PORT=3010)
# Caddy: přidat blok z deploy/Caddyfile.example (DNS fami.famicura.net → IP VPS)
```

**Docker:** `docker build -f deploy/Dockerfile -t fami-chatbot . && docker run -p 3000:3000 --env-file .env fami-chatbot`

**DigitalOcean App Platform / Kubernetes (vedle famicura.cz):** použijte Dockerfile; App Platform SSE streaming podporuje.

**Netlify (aktuální produkce – site `faminew`, https://faminew.netlify.app):** repo je napojené na Netlify, každý push do `main`
nasadí. `public/` jde na CDN, API běží jako Netlify Function `netlify/functions/api.mjs` (cesta `/api/*`, streaming SSE),
sessions jsou v Netlify Blobs (store `fami-sessions`, TTL `SESSION_TTL_MIN`). Proměnné prostředí se nastavují v Netlify
(Project configuration → Environment variables): `ANTHROPIC_API_KEY` (secret), `ANTHROPIC_MODEL`, `ALLOWED_ORIGINS`,
`FAMICURA_PROVIDER_URL`, volitelně `SESSION_TTL_MIN`, `MAX_TOKENS`, `WELCOME_MESSAGE`. Logy konverzací jsou v logu funkce
(Netlify → Logs → Functions), ne v souboru. Limit synchronní funkce je 10 s (na žádost u Netlify 26 s) – delší odpovědi
by se mohly useknout; pokud se to bude dít, řešením je VPS varianta výše nebo snížení `MAX_TOKENS`.

## Provoz a náklady

- Model `claude-sonnet-5` (nastavitelné `ANTHROPIC_MODEL`). Systémový prompt se cachuje (`cache_control: ephemeral`),
  takže po prvním dotazu v 5minutovém okně platíte za ~27 tis. tokenů promptu jen zlomek ceny.
- Sessions: na Netlify v Blobs (přežijí volání i deploy), u Express serveru v paměti (1 instance; při restartu se
  kontext modelu ztratí, widget si zobrazenou historii drží v sessionStorage). Jiné úložiště = další adaptér v `src/session-store.js`.
- Rate limit podle IP funguje jen u Express varianty (na Netlify je každé volání zvlášť).
- Logy konverzací obsahují texty klientů → nastavte retenci a přístup (GDPR); vypnout `LOG_CONVERSATIONS=false`.

## Předpoklady a rozhodnutí (k ověření)

1. **URL poskytovatelů** – famicura.cz zatím nemá veřejnou URL s parametry pro vyhledání podle služby a okresu;
   šablona `FAMICURA_PROVIDER_URL` je odhad. Buď doplní Matouš Němec (query parametry v SPA), nebo web zpracuje
   událost `fami:recommendation` sám a karta v widgetu poslouží jen jako přehled.
2. **Kódy služeb ve function callu** – schéma nástroje má `services: [ID01…ID20]` a `region {id, name}` (jako původní
   capability). Příspěvek na péči a dlouhodobé ošetřovné kód nemají (dávky, ne poskytovatelé) – model je uvádí jen v textu.
3. **Kontrola verze** – původní prompt odpovídal „verze tři tečka pět“, ačkoli jde o 3.6; opraveno na „tři tečka šest“.
4. **Hlas** – použit Web Speech API prohlížeče (zdarma, Chrome/Edge/Safari; rozpoznávání řeči nefunguje ve Firefoxu).
   Pokud chcete kvalitnější hlas (např. ElevenLabs/OpenAI TTS) nebo streaming hlasu, jde to doplnit na server jako
   další endpoint bez změny widgetu.
5. **Uvítací zpráva** převzata z původní konfigurace (v62); lze změnit v `.env` (`WELCOME_MESSAGE`).
