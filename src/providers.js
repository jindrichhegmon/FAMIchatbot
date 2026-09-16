import { config } from './config.js';

/**
 * Konkrétní poskytovatelé z Postgres Famicura – přes aplikaci `fami-poskytovatele` na jhn-apps (VPS),
 * která jediná má do databáze přístup. Chatbot ji volá s tokenem (x-app-token).
 *
 * Vrací mapu { ID01: { celkem, poskytovatele: [{ nazev, mesto, telefon, web, overeny, doporuceny, requestUrl, ... }] } }
 * Při chybě / timeoutu vrací null – karta se pak zobrazí bez poskytovatelů (odkaz na famicura.cz).
 */
export async function fetchProviders(codes, region) {
  if (!config.providersUrl || !codes.length) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.providersTimeoutMs);
  try {
    const res = await fetch(config.providersUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': config.providersToken },
      body: JSON.stringify({ kody: codes.join(','), regionId: region?.id || '', limit: config.providersPerService }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn('providers: HTTP', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    const data = json?.result?.kody || json?.kody || null;
    if (!data) return null;
    for (const k of Object.keys(data)) {
      for (const p of data[k].poskytovatele || []) {
        p.requestUrl = p.facilityServiceId ? buildRequestUrl(p.facilityServiceId) : null;
      }
    }
    return data;
  } catch (e) {
    console.warn('providers: chyba', e.name === 'AbortError' ? 'timeout' : e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function buildRequestUrl(facilityServiceId) {
  return config.requestUrl.replaceAll('{facilityServiceId}', encodeURIComponent(facilityServiceId));
}

/** Mock poskytovatelů pro vývoj bez VPS (MOCK=1). */
export function mockProviders(codes, region) {
  if (!region) return null;
  const out = {};
  for (const c of codes) {
    const list = [
      { nazev: `Ukázkový poskytovatel ${c} – ${region.name}`, mesto: region.name, telefon: '+420 777 000 000', web: 'https://www.famicura.cz', overeny: true, doporuceny: c === 'ID12', celostatni: false, typy: 'Ukázková služba', facilityServiceId: 'd3c11955-f2aa-48b0-abe1-f8cd8db675ef', sluzba: 'Ukázková služba', pocetSluzeb: 1 },
      { nazev: `Charita ${region.name}`, mesto: region.name, telefon: null, web: null, overeny: false, doporuceny: false, celostatni: false, typy: 'Ukázková služba', facilityServiceId: '9a1e0c5e-1d2b-4f6a-8e3c-a1b2c3d4e006', sluzba: 'Ukázková služba', pocetSluzeb: 2 },
    ].map((p) => ({ ...p, requestUrl: buildRequestUrl(p.facilityServiceId) }));
    out[c] = { celkem: 7, poskytovatele: list };
  }
  return out;
}
