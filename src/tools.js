import { services, okresy, buildProviderUrl, config } from './config.js';
import { fetchProviders, mockProviders } from './providers.js';

const serviceByCode = new Map(services.map((s) => [s.code, s]));
const okresById = new Map(okresy.map((o) => [o.id, o]));
const okresByName = new Map(okresy.map((o) => [o.name.toLowerCase(), o]));

/**
 * Definice nástroje pro Claude API (tool use).
 * Odpovídá původní capability "recommended-services" – required: services, volitelný region {id, name}.
 */
export const recommendedServicesTool = {
  name: 'recommended-services',
  description:
    'Zavolej vždy, když klientovi doporučuješ konkrétní typy služeb nebo když klient sám řekne, jakou službu hledá – ' +
    'i bez znalosti okresu. Jakmile se okres dozvíš, zavolej znovu se stejnými službami a s parametrem region. ' +
    'Frontend podle výsledku zobrazí klientovi kartu s poskytovateli k výběru. Vrať kódy všech služeb, které v odpovědi doporučuješ.',
  input_schema: {
    type: 'object',
    required: ['services'],
    properties: {
      services: {
        type: 'array',
        minItems: 1,
        description: 'Kódy doporučených služeb (bez duplicit).',
        items: {
          type: 'string',
          enum: services.map((s) => s.code),
        },
      },
      region: {
        type: 'object',
        description: 'Okres klienta, pokud je znám. id i name musí odpovídat seznamu okresů.',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', enum: okresy.map((o) => o.id) },
          name: { type: 'string', enum: okresy.map((o) => o.name) },
        },
      },
    },
  },
};

export const tools = [recommendedServicesTool];

/**
 * Zpracuje vstup nástroje: zvaliduje, obohatí o názvy a URL, dohledá konkrétní poskytovatele
 * (Postgres Famicura přes jhn-apps, jen když je znám okres) a vrátí
 * { forClient, forModel } – forClient jde do widgetu (SSE event), forModel je tool_result pro Claude.
 */
export async function handleRecommendedServices(input = {}) {
  const codes = [...new Set((input.services || []).filter((c) => serviceByCode.has(c)))];

  let region = null;
  if (input.region?.id && okresById.has(input.region.id)) {
    region = { ...okresById.get(input.region.id) };
  } else if (input.region?.name && okresByName.has(String(input.region.name).toLowerCase())) {
    region = { ...okresByName.get(String(input.region.name).toLowerCase()) };
  }

  const providers = region && codes.length ? (config.mock ? mockProviders(codes, region) : await fetchProviders(codes, region)) : null;

  const items = codes.map((code) => {
    const s = serviceByCode.get(code);
    const p = providers?.[code];
    return {
      code,
      name: s.name,
      short: s.short,
      type: s.type,
      url: buildProviderUrl(code, region),
      providers: p ? p.poskytovatele : null, // null = nedohledáváno / nedostupné, [] = v okrese nikdo
      providersTotal: p ? p.celkem : null,
    };
  });

  const forClient = { services: items, region, providersLoaded: Boolean(providers), at: new Date().toISOString() };

  const summary = items.map((i) => {
    if (!i.providers) return `${i.name}: poskytovatelé se nedohledávali`;
    if (!i.providers.length) return `${i.name}: v databázi FamiCura zatím žádný poskytovatel pro tento okres`;
    const names = i.providers.slice(0, 3).map((p) => p.nazev + (p.mesto ? ` (${p.mesto})` : '') + (p.doporuceny ? ' – doporučený' : p.overeny ? ' – ověřený' : ''));
    const more = i.providersTotal > i.providers.length ? ` a dalších ${i.providersTotal - i.providers.length}` : '';
    return `${i.name}: ${names.join('; ')}${more}`;
  });

  const forModel = {
    ok: true,
    recommended: items.map((i) => i.name),
    region: region ? region.name : null,
    providers: region ? summary : undefined,
    note: !region
      ? 'Klientovi se zobrazila karta doporučených služeb bez okresu. Zeptej se na okres nebo město a po odpovědi zavolej nástroj znovu s regionem.'
      : providers
        ? `Klientovi se zobrazila karta s konkrétními poskytovateli pro okres ${region.name} (názvy, město, kontakt, tlačítko Žádost o péči). V textu můžeš jmenovat nejvýše první dva až tři z každé služby a odkázat na kartu; kódy služeb nepiš.`
        : `Klientovi se zobrazila karta služeb pro okres ${region.name}; konkrétní poskytovatelé se teď nepodařilo načíst – nasměruj klienta na výběr poskytovatele na www.famicura.cz. Kódy služeb nepiš.`,
  };
  return { forClient, forModel };
}

export async function runTool(name, input) {
  if (name === 'recommended-services') return handleRecommendedServices(input);
  return { forClient: null, forModel: { ok: false, error: `Neznámý nástroj ${name}` } };
}
