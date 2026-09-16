import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

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
