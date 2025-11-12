import * as cds from "@sap/cds";
const { Symbol, SymbolTranslation } = cds.entities;

export const translate = async (req: cds.Request) => {
  // Input: req.params may be a single ID, an array of IDs, or empty (meaning: translate all symbols)
  let ids: any[] = Array.isArray(req.params) ? req.params : (req.params ? [req.params] : []);
  const results: any[] = [];
  const translationsOut: Array<string | null> = [];

  // Load all translation mapping records once
  const translationsRaw: any[] = await SELECT.from(SymbolTranslation);
//ID;language;symbol;translation
  // Helper: pick a likely text field from a symbol record
  const pickTextField = (record: any) => {
    // Prefer the actual symbol field (lowercase or PascalCase), then an explicit translation field,
    // then any other string field. Avoid selecting the ID field as the primary text.
    const candidates = ["symbol", "Symbol", "translation", "Translation", "text", "Text"];
    if (record) {
      for (const c of candidates) {
        if (Object.prototype.hasOwnProperty.call(record, c) && typeof record[c] === "string") {
          return c;
        }
      }
      // fallback: pick the first non-ID string field
      for (const k of Object.keys(record)) {
        if ((k.toLowerCase() === 'id')) continue;
        if (typeof record[k] === "string") return k;
      }
    }
    return null;
  };

  // Helper: extract mapping pair from various possible field names
  const extractPair = (t: any) => {
    const from = t.Source || t.source || t.From || t.from || t.Token || t.symbol || t.symbolValue;
    const to = t.Target || t.target || t.To || t.to || t.Translation || t.translation || t.translated;
    return { from, to, raw: t };
  };

  const mappingPairs = translationsRaw.map(extractPair).filter(p => typeof p.from === "string" && typeof p.to === "string");

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // If no ids provided, translate all symbols in the database
  if (!ids || ids.length === 0) {
    const rows: any[] = await SELECT.from(Symbol).columns('ID');
    ids = rows.map(r => r.ID);
  }

  for (const id of ids) {
    try {
      const record: any = await SELECT.one.from(Symbol).where({ ID: id });
      if (!record) {
        results.push({ translation: null, ok: false, reason: "not found" });
        translationsOut.push(null);
        continue;
      }

      const textField = pickTextField(record);
      if (!textField) {
        results.push({ translation: null, ok: false, reason: "no text field found on symbol" });
        translationsOut.push(null);
        continue;
      }

      const original = record[textField] as string;
      let translated = original;

      // Translate by token (symbol) rather than by regex replacements.
      // Build an in-memory map: translationsByLang[language][symbol] = translation
      const translationsByLang: Record<string, Record<string, string>> = {};
      for (const t of translationsRaw) {
        const langKey = t.language ?? '';
        translationsByLang[langKey] = translationsByLang[langKey] || {};
        translationsByLang[langKey][t.symbol] = t.translation;
      }

      // Split into symbol tokens (split on whitespace and common separators), translate each token,
      // then join translated tokens with a single space so multiple symbols become readable words.
      const tokens = original.split(/[\s,;\/|]+/).filter(t => t && t.length > 0);
      const langKey = record.language ?? '';
      const mappedTokens = tokens.map(tok => {
        let found: string | undefined;
        if (translationsByLang[langKey] && translationsByLang[langKey][tok]) found = translationsByLang[langKey][tok];
        if (!found && translationsByLang[''] && translationsByLang[''][tok]) found = translationsByLang[''][tok];
        if (!found) {
          // case-insensitive search across all languages
          for (const lk of Object.keys(translationsByLang)) {
            const m = Object.keys(translationsByLang[lk]).find(k => k.toLowerCase() === tok.toLowerCase());
            if (m) {
              found = translationsByLang[lk][m];
              break;
            }
          }
        }
        return found ?? tok;
      });

      // Join with single spaces per your request ("paste them next to each other with a space").
      translated = mappedTokens.join(' ');

      // Upsert into SymbolTranslation table (match by symbol text + language)
      const symbolKey = record.symbol ?? original;
      const lang = record.language ?? null;

      if (translated !== original) {
        const existing: any = await SELECT.one.from(SymbolTranslation).where({ symbol: symbolKey, language: lang });
        if (existing) {
          await UPDATE(SymbolTranslation).set({ translation: translated }).where({ ID: existing.ID });
          results.push({ translation: translated, ok: true, updated: "SymbolTranslation", id: existing.ID, before: original, after: translated });
        } else {
          await INSERT.into(SymbolTranslation).entries([{ symbol: symbolKey, translation: translated, language: lang }]);
          results.push({ translation: translated, ok: true, created: "SymbolTranslation", before: original, after: translated });
        }

        // Also persist the composed translation onto the Symbol row so the UI's `translation` column
        // shows the new text immediately after refresh/read.
        try {
          await UPDATE(Symbol).set({ translation: translated }).where({ ID: id });
        } catch (uerr) {
          // non-fatal: log and continue
          console.error('Failed to update Symbol.translation for', id, String(uerr));
        }

        translationsOut.push(translated);
      } else {
        const existing: any = await SELECT.one.from(SymbolTranslation).where({ symbol: symbolKey, language: lang });
        const finalTranslation = existing?.translation ?? original;
        if (!existing) {
          await INSERT.into(SymbolTranslation).entries([{ symbol: symbolKey, translation: original, language: lang }]);
          results.push({ translation: original, ok: true, created: "SymbolTranslation", before: null, after: original });
        } else {
          results.push({ translation: finalTranslation, ok: true, message: "no changes" });
        }

        // Ensure Symbol.translation reflects the current translation
        try {
          await UPDATE(Symbol).set({ translation: finalTranslation }).where({ ID: id });
        } catch (uerr) {
          console.error('Failed to update Symbol.translation for', id, String(uerr));
        }

        translationsOut.push(finalTranslation);
      }
      } catch (e) {
      results.push({ translation: null, ok: false, reason: (e && (e as any).message) || String(e) });
      translationsOut.push(null);
    }
  }

  // If a single id was provided, return a single string (or null on error), otherwise return array of strings/nulls
  if (translationsOut.length === 1) return translationsOut[0];
  return translationsOut;
};
