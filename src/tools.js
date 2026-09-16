import { services, okresy, buildProviderUrl } from './config.js';

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
 * Zpracuje vstup nástroje: zvaliduje, obohatí o názvy a URL a vrátí
 * { forClient, forModel } – forClient jde do widgetu (SSE event), forModel je tool_result pro Claude.
 */
export function handleRecommendedServices(input = {}) {
  const codes = [...new Set((input.services || []).filter((c) => serviceByCode.has(c)))];

  let region = null;
  if (input.region?.id && okresById.has(input.region.id)) {
    region = { ...okresById.get(input.region.id) };
  } else if (input.region?.name && okresByName.has(String(input.region.name).toLowerCase())) {
    region = { ...okresByName.get(String(input.region.name).toLowerCase()) };
  }

  const items = codes.map((code) => {
    const s = serviceByCode.get(code);
    return { code, name: s.name, short: s.short, type: s.type, url: buildProviderUrl(code, region) };
  });

  const forClient = { services: items, region, at: new Date().toISOString() };
  const forModel = {
    ok: true,
    recommended: items.map((i) => i.name),
    region: region ? region.name : null,
    note: region
      ? `Klientovi se zobrazila karta s poskytovateli pro okres ${region.name}. Kódy služeb do textu nepiš.`
      : 'Klientovi se zobrazila karta doporučených služeb bez okresu. Zeptej se na okres nebo město a po odpovědi zavolej nástroj znovu s regionem.',
  };
  return { forClient, forModel };
}

export function runTool(name, input) {
  if (name === 'recommended-services') return handleRecommendedServices(input);
  return { forClient: null, forModel: { ok: false, error: `Neznámý nástroj ${name}` } };
}
