/**
 * Fami chatbot – poskytovatelé služeb z Postgres Famicura (famicura_core).
 * Pevný parametrizovaný dotaz: kódy kategorií služeb (ID01…ID20) + okres → poskytovatelé,
 * seskupení po poskytovateli, sponzorovaní/ověření první, max N na kategorii.
 *
 * Volá ho backend chatbotu (Netlify Function) s hlavičkou x-app-token = FAMI_CHATBOT_TOKEN.
 * Vrací: { kody: { ID01: { celkem, poskytovatele: [...] }, ... } }
 *
 * Proměnné prostředí (.env jhn-apps):
 *   FAMI_CHATBOT_TOKEN   token, kterým se chatbot ohlašuje (povinný – bez něj app odmítá)
 *   FAMI_PG_DB           název Postgres spojení (výchozí famicurapg)
 */
import { z } from 'zod';

const PG = (process.env.FAMI_PG_DB || 'famicurapg').toLowerCase();
const KOD = /^ID\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SQL = `
WITH sluzby AS (
  SELECT sc.code AS kod, p.id AS provider_id, p.name AS provider, p.city, p.contact_phone, p.contact_email, p.website_url,
         COALESCE(p.verified, false) AS verified, COALESCE(p.sponsored, false) AS sponsored,
         fs.id AS fs_id, fs.name AS fs_name, st.name AS typ, f.city AS facility_city,
         COALESCE(fs.covers_whole_country, false) AS whole
  FROM facility_services fs
  JOIN service_types st ON st.id = fs.service_type_id
  JOIN service_categories sc ON sc.id = st.service_category_id
  JOIN facilities f ON f.id = fs.facility_id
  JOIN providers p ON p.id = f.provider_id
  WHERE fs.status = 'Active'
    AND COALESCE(p.status, 'Active') <> 'Inactive'
    AND p.name NOT ILIKE '%demo%'
    AND sc.code = ANY(string_to_array(@kody, ','))
    AND (
      COALESCE(fs.covers_whole_country, false)
      OR EXISTS (SELECT 1 FROM facility_service_region r WHERE r.facility_service_id = fs.id AND r.region_id = @regionId::uuid)
    )
),
podle_poskytovatele AS (
  SELECT kod, provider_id, provider, city, contact_phone, contact_email, website_url, verified, sponsored,
         bool_and(whole) AS jen_celostatni,
         count(*) AS n_sluzeb,
         string_agg(DISTINCT typ, ', ') AS typy,
         (array_agg(fs_id ORDER BY whole ASC, (facility_city = city) DESC NULLS LAST, fs_name))[1] AS fs_id,
         (array_agg(fs_name ORDER BY whole ASC, (facility_city = city) DESC NULLS LAST, fs_name))[1] AS fs_name
  FROM sluzby
  GROUP BY kod, provider_id, provider, city, contact_phone, contact_email, website_url, verified, sponsored
),
serazeno AS (
  SELECT *,
         row_number() OVER (PARTITION BY kod ORDER BY sponsored DESC, verified DESC, jen_celostatni ASC, provider) AS poradi,
         count(*) OVER (PARTITION BY kod) AS celkem
  FROM podle_poskytovatele
)
SELECT kod, provider_id, provider, city, contact_phone, contact_email, website_url, verified, sponsored,
       jen_celostatni, n_sluzeb, typy, fs_id, fs_name, poradi, celkem
FROM serazeno
WHERE poradi <= @limit
ORDER BY kod, poradi`;

export default {
  name: 'fami-poskytovatele',
  description: 'Fami chatbot – poskytovatelé z Postgres Famicura podle kódů služeb (ID01…) a okresu. Určeno pro backend chatbotu, ne pro Claude.',
  mcp: false,
  publicToken: process.env.FAMI_CHATBOT_TOKEN || '',
  input: {
    kody: z.string().min(4).max(200).describe('Kódy kategorií služeb oddělené čárkou, např. ID01,ID03'),
    regionId: z.string().default('').describe('UUID okresu (regions.id); prázdné = jen celostátní služby'),
    limit: z.coerce.number().int().min(1).max(20).default(5).describe('Max. poskytovatelů na kategorii'),
  },
  async run(input, ctx) {
    if (!process.env.FAMI_CHATBOT_TOKEN) throw Object.assign(new Error('FAMI_CHATBOT_TOKEN není nastaven'), { status: 503 });
    const kody = [...new Set(String(input.kody).split(',').map((k) => k.trim().toUpperCase()).filter((k) => KOD.test(k)))];
    if (!kody.length) throw Object.assign(new Error('Žádný platný kód služby'), { status: 400 });
    const regionId = UUID.test(String(input.regionId || '').trim()) ? String(input.regionId).trim().toLowerCase() : null;

    // regionId = null → podmínka na okres nikdy nesedí, zůstanou jen celostátní služby
    const rows = await ctx.db(PG).query(SQL, { kody: kody.join(','), regionId, limit: input.limit });
    ctx.log(`kody=${kody.join(',')} region=${regionId || '-'} → ${rows.length} řádků`);

    const out = {};
    for (const k of kody) out[k] = { celkem: 0, poskytovatele: [] };
    for (const r of rows) {
      const o = out[r.kod] || (out[r.kod] = { celkem: 0, poskytovatele: [] });
      o.celkem = Number(r.celkem) || 0;
      o.poskytovatele.push({
        providerId: r.provider_id,
        nazev: r.provider,
        mesto: r.city || null,
        telefon: r.contact_phone || null,
        email: r.contact_email || null,
        web: r.website_url || null,
        overeny: Boolean(r.verified),
        doporuceny: Boolean(r.sponsored),
        celostatni: Boolean(r.jen_celostatni),
        typy: r.typy || null,
        facilityServiceId: r.fs_id,
        sluzba: r.fs_name || null,
        pocetSluzeb: Number(r.n_sluzeb) || 1,
      });
    }
    return { region: regionId || null, kody: out };
  },
};
