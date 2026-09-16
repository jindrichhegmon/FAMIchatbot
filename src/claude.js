import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { getSystemBlocks } from './prompt.js';
import { tools, runTool } from './tools.js';
import { trimHistory } from './sessions.js';
import { mockTurn } from './mock.js';

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.apiKey });
  return client;
}
/** Pro testy: podstrčení falešného klienta se stejným rozhraním messages.stream(). */
export function setClient(c) { client = c; }

const MAX_TOOL_ROUNDS = 4;

/**
 * Jedno kolo konverzace: přidá user zprávu, streamuje odpověď Claude,
 * obslouží tool_use (recommended-services) a případně pokračuje dalším voláním.
 *
 * emit(event, data) – 'text' {delta}, 'recommendation' {...}, 'done' {usage}, 'error' {message}
 */
export async function runTurn(session, userText, emit) {
  session.messages.push({ role: 'user', content: userText });
  trimHistory(session);

  if (config.mock) return mockTurn(session, userText, emit);

  const anthropic = getClient();
  let fullText = '';
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: getSystemBlocks(),
      tools,
      messages: session.messages,
    });

    stream.on('text', (delta) => {
      fullText += delta;
      emit('text', { delta });
    });

    const final = await stream.finalMessage();
    for (const k of Object.keys(usage)) usage[k] += final.usage?.[k] || 0;

    // Uložíme kompletní obsah odpovědi (text + tool_use bloky) do historie.
    session.messages.push({ role: 'assistant', content: final.content });

    const toolUses = final.content.filter((b) => b.type === 'tool_use');
    if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    const results = [];
    for (const tu of toolUses) {
      const { forClient, forModel } = runTool(tu.name, tu.input);
      if (forClient) {
        session.lastRecommendation = forClient;
        emit('recommendation', forClient);
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(forModel) });
    }
    session.messages.push({ role: 'user', content: results });
    // pokračujeme dalším kolem – model obvykle dopíše text po tool_result
  }

  emit('done', { usage, text: fullText });
  return fullText;
}
