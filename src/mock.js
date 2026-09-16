import { runTool } from './tools.js';
import { okresy } from './config.js';

/**
 * Mock režim (MOCK=1) – bez Claude API. Slouží k vývoji widgetu a testům.
 * Simuluje streamování textu, scénář S8 (bolest kloubů) a opakované volání nástroje s okresem.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function streamText(text, emit) {
  const words = text.split(/(\s+)/);
  for (const w of words) {
    if (!w) continue;
    emit('text', { delta: w });
    await sleep(15);
  }
}

function findOkres(text) {
  const t = text.toLowerCase();
  if (/\bprah/.test(t)) return okresy.find((o) => o.name === 'Hlavní město Praha');
  if (/\bbrn/.test(t)) return okresy.find((o) => o.name === 'Brno-město');
  return okresy.find((o) => t.includes(o.name.toLowerCase().split(' ')[0].replace(/-.*/, '')));
}

export async function mockTurn(session, userText, emit) {
  const t = userText.toLowerCase();
  let out = '';
  const say = async (s) => { out += s; await streamText(s, emit); };

  if (t.trim() === 'kontrola verze') {
    await say('verze tři tečka šest');
  } else if (/kloub|koleno|kyčel|rameno|záda|artróz/.test(t)) {
    const region = findOkres(t);
    const { forClient } = runTool('recommended-services', { services: ['ID12'], region: region ? { id: region.id, name: region.name } : undefined });
    session.lastRecommendation = forClient;
    emit('recommendation', forClient);
    await say('Na bolest kloubů je vhodná ambulantní léčba – regenerativní medicína. Zobrazuji vám poskytovatele, ze kterých si můžete vybrat. Doporučuji kliniku Joint Care – specializuje se na cílenou léčbu kloubů pod ultrazvukovou navigací a působí v Praze a ve Zlíně. ');
    await say(region ? `Pro okres ${region.name} jsem nabídku upřesnila.` : 'Abych nabídku upřesnila, řekněte mi prosím, z jakého jste okresu nebo města.');
  } else if (findOkres(t) && session.lastRecommendation) {
    const region = findOkres(t);
    const codes = session.lastRecommendation.services.map((s) => s.code);
    const { forClient } = runTool('recommended-services', { services: codes, region: { id: region.id, name: region.name } });
    session.lastRecommendation = forClient;
    emit('recommendation', forClient);
    await say(`${region.name}, ${forClient.services.map((s) => s.name.toLowerCase()).join(', ')}.\n\nV okrese ${region.name} doporučuji oslovit poskytovatele těchto služeb:\n\n`);
    for (let i = 0; i < forClient.services.length; i++) await say(`Za ${['prvé', 'druhé', 'třetí', 'čtvrté', 'páté'][i]} – ${forClient.services[i].name}.\n`);
    await say('\nJak postupovat:\n\nZa prvé – na stránce www.famicura.cz si vyberte poskytovatele.\nZa druhé – pokud u nich najdete tlačítko Žádost o péči, vyplňte ji.\nZa třetí – poskytovatelé by se vám měli ozvat do dvaceti čtyř hodin.\nZa čtvrté – pro rychlejší vyřízení dokončete registraci na www.famicura.cz.');
  } else if (/nemocnic|hospic|umír|paliat|demenc|alzheim|senior|péč|pomoc/.test(t)) {
    const codes = /demenc|alzheim/.test(t) ? ['ID06', 'ID10'] : /hospic|umír|paliat/.test(t) ? ['ID01', 'ID03'] : ['ID03', 'ID15'];
    const { forClient } = runTool('recommended-services', { services: codes });
    session.lastRecommendation = forClient;
    emit('recommendation', forClient);
    await say('Na základě toho, co jste mi sdělil/a, doporučuji tyto služby:\n\n');
    for (let i = 0; i < forClient.services.length; i++) await say(`Za ${['prvé', 'druhé', 'třetí'][i]} – ${forClient.services[i].name} (${forClient.services[i].short.toLowerCase().replace(/\.$/, '')}).\n`);
    await say('Za třetí – příspěvek na péči (měsíční dávka na úhradu péče).\n\nPokud chcete, můžu kteroukoliv z nich vysvětlit podrobněji. A abych vám mohla najít konkrétní poskytovatele, řekněte mi prosím, z jakého jste okresu nebo města.');
  } else {
    await say('Abych vám pomohla co nejrychleji, řekněte mi prosím, o koho jde a zda si přejete péči doma, nebo v zařízení?');
  }

  session.messages.push({ role: 'assistant', content: [{ type: 'text', text: out }] });
  emit('done', { usage: { mock: true }, text: out });
  return out;
}
