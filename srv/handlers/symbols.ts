import * as cds from "@sap/cds";
const { Symbol, SymbolTranslation } = cds.entities;

function toIdArray(params: any): string[] {
  if (Array.isArray(params)) return params as string[];
  if (!params) return [];
  return [params] as string[];
}

function chooseTextField(record: any): string | null {
  const preferred = ["symbol", "Symbol", "translation", "Translation", "text", "Text"];
  for (const p of preferred) if (record && Object.prototype.hasOwnProperty.call(record, p) && typeof record[p] === "string") return p;
  for (const k of Object.keys(record || {})) if (k.toLowerCase() !== "id" && typeof record[k] === "string") return k;
  return null;
}

function buildLookup(translationsRaw: any[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const t of translationsRaw || []) {
    const lang = t.language ?? "";
    out[lang] = out[lang] || {};
    if (typeof t.symbol === "string" && typeof t.translation === "string") out[lang][t.symbol] = t.translation;
  }
  return out;
}

function translateTokens(original: string, lookup: Record<string, Record<string, string>>, lang: string): string {
  const tokens = (original || "").split(/[\s,;\/|]+/).filter(Boolean);
  return tokens
    .map(tok => {
      if (lookup[lang] && lookup[lang][tok]) return lookup[lang][tok];
      if (lookup[""] && lookup[""][tok]) return lookup[""][tok];
      for (const lk of Object.keys(lookup)) {
        const match = Object.keys(lookup[lk]).find(k => k.toLowerCase() === tok.toLowerCase());
        if (match) return lookup[lk][match];
      }
      return tok;
    })
    .join(" ");
}

async function upsertTranslation(symbolKey: string, lang: string | null, translated: string) {
  const existing: any = await SELECT.one.from(SymbolTranslation).where({ symbol: symbolKey, language: lang });
  if (existing) {
    await UPDATE(SymbolTranslation).set({ translation: translated }).where({ ID: existing.ID });
    return { action: "update", id: existing.ID };
  }
  const entries = [{ symbol: symbolKey, translation: translated, language: lang }];
  await INSERT.into(SymbolTranslation).entries(entries);
  return { action: "insert" };
}

async function ensureSymbolRowTranslation(id: any, value: string) {
  try {
    await UPDATE(Symbol).set({ translation: value }).where({ ID: id });
  } catch (e) {
    console.error("Failed to set Symbol.translation", id, e);
  }
}

export const translate = async (req: cds.Request) => {
  const ids = toIdArray(req.params);
  const resultOut: Array<string | null> = [];
  const translationsRaw: any[] = await SELECT.from(SymbolTranslation);
  const lookup = buildLookup(translationsRaw);

  const targetIds = ids.length ? ids : (await SELECT.from(Symbol).columns("ID")).map((r: any) => r.ID);

  for (const id of targetIds) {
    try {
      const record: any = await SELECT.one.from(Symbol).where({ ID: id });
      if (!record) {
        resultOut.push(null);
        continue;
      }
      const field = chooseTextField(record);
      if (!field) {
        resultOut.push(null);
        continue;
      }
      const original = String(record[field] || "");
      const lang = record.language ?? "";
      const translated = translateTokens(original, lookup, lang);
      const symbolKey = record.symbol ?? original;

      if (translated !== original) {
        await upsertTranslation(symbolKey, record.language ?? null, translated);
        await ensureSymbolRowTranslation(id, translated);
        resultOut.push(translated);
      } else {
        const existing: any = await SELECT.one.from(SymbolTranslation).where({ symbol: symbolKey, language: record.language ?? null });
        const final = existing?.translation ?? original;
        if (!existing) await INSERT.into(SymbolTranslation).entries([{ symbol: symbolKey, translation: original, language: record.language ?? null }]);
        await ensureSymbolRowTranslation(id, final);
        resultOut.push(final);
      }
    } catch (e) {
      console.error("translate failed for id", id, e);
      resultOut.push(null);
    }
  }

  return resultOut.length === 1 ? resultOut[0] : resultOut;
};
