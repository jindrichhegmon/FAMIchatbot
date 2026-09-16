import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRecommendedServices, recommendedServicesTool } from '../src/tools.js';
import { getSystemPrompt } from '../src/prompt.js';
import { newSession } from '../src/session-store.js';
import { runTurn, setClient } from '../src/claude.js';
import { config, okresy, services } from '../src/config.js';

test('tool schema má všechny služby a okresy', () => {
  assert.equal(recommendedServicesTool.input_schema.properties.services.items.enum.length, services.length);
  assert.equal(recommendedServicesTool.input_schema.properties.region.properties.id.enum.length, okresy.length);
  assert.ok(okresy.length >= 77);
});

test('handleRecommendedServices: validace, dedup, URL, region', async () => {
  const zlin = okresy.find((o) => o.name === 'Zlín');
  const { forClient, forModel } = await handleRecommendedServices({ services: ['ID12', 'ID12', 'XX'], region: { id: zlin.id, name: 'Zlín' } });
  assert.equal(forClient.services.length, 1);
  assert.equal(forClient.services[0].code, 'ID12');
  assert.ok(forClient.services[0].url.includes(zlin.id));
  assert.equal(forClient.region.name, 'Zlín');
  assert.equal(forModel.region, 'Zlín');
});

test('handleRecommendedServices: region podle názvu, bez regionu', async () => {
  const a = await handleRecommendedServices({ services: ['ID01'], region: { id: 'nesmysl', name: 'Brno-město' } });
  assert.equal(a.forClient.region.name, 'Brno-město');
  const b = await handleRecommendedServices({ services: ['ID01'] });
  assert.equal(b.forClient.region, null);
  assert.match(b.forModel.note, /okres/i);
});

test('system prompt obsahuje okresy a klíčové sekce', () => {
  const p = getSystemPrompt();
  assert.ok(!p.includes('{{OKRESY}}'));
  assert.ok(p.includes('ae6719bc-d514-1a50-8c9f-7094e78f66e9'));
  assert.ok(p.includes('recommended-services'));
  assert.ok(p.includes('verze tři tečka šest'));
});

test('tool loop: tool_use → tool_result → pokračování, historie konzistentní', async () => {
  config.mock = false;
  const calls = [];
  let n = 0;
  const fake = {
    messages: {
      stream(params) {
        calls.push({ ...params, messages: [...params.messages] }); // snapshot (pole se dál mutuje)
        n++;
        const handlers = {};
        const final =
          n === 1
            ? { content: [{ type: 'text', text: 'Doporučuji mobilní hospic. ' }, { type: 'tool_use', id: 'tu1', name: 'recommended-services', input: { services: ['ID01'] } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } }
            : { content: [{ type: 'text', text: 'Z jakého jste okresu?' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 4 } };
        return {
          on(ev, fn) { handlers[ev] = fn; return this; },
          async finalMessage() {
            for (const b of final.content) if (b.type === 'text') handlers.text?.(b.text);
            return final;
          },
        };
      },
    },
  };
  setClient(fake);
  const session = newSession();
  const events = [];
  const text = await runTurn(session, 'Maminka umírá a chce být doma', (e, d) => events.push([e, d]));
  assert.equal(calls.length, 2);
  assert.equal(text, 'Doporučuji mobilní hospic. Z jakého jste okresu?');
  assert.ok(events.some(([e, d]) => e === 'recommendation' && d.services[0].code === 'ID01'));
  // historie: user, assistant(tool_use), user(tool_result), assistant
  assert.deepEqual(session.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(session.messages[2].content[0].type, 'tool_result');
  assert.equal(session.messages[2].content[0].tool_use_id, 'tu1');
  // druhé volání dostalo celou historii a system prompt s cache_control
  assert.equal(calls[1].messages.length, 3);
  assert.equal(calls[1].system[0].cache_control.type, 'ephemeral');
  assert.equal(calls[1].tools[0].name, 'recommended-services');
  const done = events.find(([e]) => e === 'done')[1];
  assert.equal(done.usage.input_tokens, 22);
});
