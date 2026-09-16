import fs from 'node:fs';
import path from 'node:path';
import { ROOT, okresy } from './config.js';

const PROMPT_PATH = path.join(ROOT, 'prompt', 'system-prompt.md');

let cached = null;
let cachedMtime = 0;

/** Načte systémový prompt; {{OKRESY}} nahradí seznamem z config/okresy.json (jediný zdroj pravdy). */
export function getSystemPrompt() {
  const mtime = fs.statSync(PROMPT_PATH).mtimeMs;
  if (cached && mtime === cachedMtime) return cached;
  const raw = fs.readFileSync(PROMPT_PATH, 'utf8');
  const okresyText = okresy.map((o) => `- ${o.name} — ${o.id}`).join('\n');
  cached = raw.replace('{{OKRESY}}', okresyText);
  cachedMtime = mtime;
  return cached;
}

/** System prompt jako bloky s cache_control – prompt je dlouhý, cachování výrazně šetří náklady i latenci. */
export function getSystemBlocks() {
  return [{ type: 'text', text: getSystemPrompt(), cache_control: { type: 'ephemeral' } }];
}
