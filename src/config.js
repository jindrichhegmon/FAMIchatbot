import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Kořen projektu (kde leží config/ a prompt/). Lokálně je to ../ od src/, v Netlify Functions
 * je kód zabundlovaný jinam a soubory z included_files leží relativně k process.cwd().
 */
function findRoot() {
  const candidates = [
    process.env.FAMI_ROOT,
    path.resolve(MODULE_DIR, '..'),
    path.resolve(MODULE_DIR, '../..'),
    process.cwd(),
    '/var/task',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'config', 'services.json'))) return c;
  }
  return path.resolve(MODULE_DIR, '..');
}
export const ROOT = findRoot();

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

export const services = readJson('config/services.json');
export const okresy = readJson('config/okresy.json');

const bool = (v, d = false) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  mock: bool(process.env.MOCK, false),
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  maxTokens: num(process.env.MAX_TOKENS, 1024),
  temperature: num(process.env.TEMPERATURE, 0.4),
  // Kam odkazovat z karty doporučených služeb. Placeholdery: {serviceCode}, {regionId}, {regionName}
  providerUrl: process.env.FAMICURA_PROVIDER_URL || 'https://famicura.cz/?service={serviceCode}&region={regionId}',
  homeUrl: process.env.FAMICURA_HOME_URL || 'https://www.famicura.cz',
  // Povolené originy pro CORS (čárkou oddělené). Prázdné = jen same-origin.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  sessionTtlMin: num(process.env.SESSION_TTL_MIN, 60),
  // auto = Netlify Blobs na Netlify, jinak paměť; nebo 'memory' / 'blobs'
  sessionStore: process.env.SESSION_STORE || 'auto',
  maxHistoryMessages: num(process.env.MAX_HISTORY_MESSAGES, 40),
  maxUserChars: num(process.env.MAX_USER_CHARS, 2000),
  rateLimitPerMin: num(process.env.RATE_LIMIT_PER_MIN, 30),
  logDir: process.env.LOG_DIR || path.join(ROOT, 'logs'),
  logConversations: bool(process.env.LOG_CONVERSATIONS, true),
  welcome:
    process.env.WELCOME_MESSAGE ||
    'Dobrý den, jsem asistentka Fami a pomohu vám se zorientovat v možnostech péče nebo společně najít řešení vaší konkrétní situace. Můžete mi psát nebo si zapněte mikrofon a zvuk pro hlasovou konverzaci. S čím vám mohu pomoci?',
};

export function buildProviderUrl(serviceCode, region) {
  return config.providerUrl
    .replaceAll('{serviceCode}', encodeURIComponent(serviceCode || ''))
    .replaceAll('{regionId}', encodeURIComponent(region?.id || ''))
    .replaceAll('{regionName}', encodeURIComponent(region?.name || ''));
}
