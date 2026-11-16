// Dokumenttexte eines Enigma-Levels (el:i18n), gemeinsam für tools/import-enigma.mjs und
// tools/texte-en.mjs (docs/SPEC-englisch.md, „Dokumenttexte aus Enigma“).

export const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/**
 * Texte nach Schlüssel: `texts` = deutsche Übersetzung, sonst Englisch (wie bisher); `textsEn` = das
 * englische Original für die Schlüssel, deren `texts` die deutsche Übersetzung ist und davon abweicht.
 * Spätere Einträge desselben Schlüssels (el:public) gewinnen wie bisher.
 */
export function levelTexts(xml) {
  const texts = {};
  const textsEn = {};
  for (const m of xml.matchAll(/<el:string el:key="([^"]*)">([\s\S]*?)<\/el:string>/g)) {
    const de = /<el:translation el:lang="de"[^>]*>([\s\S]*?)<\/el:translation>/.exec(m[2]);
    const en = /<el:english[^>]*>([\s\S]*?)<\/el:english>/.exec(m[2]);
    const t = de?.[1] ?? en?.[1];
    if (!(t && unxml(t))) continue;
    texts[m[1]] = unxml(t);
    const e = de && en ? unxml(en[1]) : '';
    if (e && e !== texts[m[1]]) textsEn[m[1]] = e;
    else delete textsEn[m[1]];
  }
  return { texts, textsEn };
}

/**
 * Trägt `textsEn` in eine Paketdatei (public/levels/enigma/<pack>.json, Text wie vom Import geschrieben)
 * ein, ohne sonst etwas zu ändern: gleiche Serialisierung wie tools/import-enigma.mjs, `textsEn` direkt
 * nach `texts`, nur für Levels mit `texts` und nur, wenn nicht leer. `xmlFor(source)` liefert das
 * Enigma-XML des Levels oder null. Wirft, wenn die Datei nicht exakt so serialisiert ist wie der Import.
 */
export function withTextsEn(raw, xmlFor) {
  const data = JSON.parse(raw);
  if (JSON.stringify(data) + '\n' !== raw) throw new Error('Datei ist nicht so serialisiert wie der Import');
  const stats = { levels: 0, withTextsEn: 0, missingXml: [], differs: [] };
  data.levels = data.levels.map((level) => {
    if (!level.texts || !level.source) return level;
    stats.levels++;
    const xml = xmlFor(level.source);
    if (xml == null) {
      stats.missingXml.push(level.id);
      return level;
    }
    const fromXml = levelTexts(xml);
    const textsEn = {};
    for (const k of Object.keys(level.texts)) {
      if (fromXml.texts[k] !== level.texts[k]) stats.differs.push(`${level.id}/${k}`);
      if (fromXml.textsEn[k] !== undefined && fromXml.textsEn[k] !== level.texts[k]) textsEn[k] = fromXml.textsEn[k];
    }
    if (Object.keys(textsEn).length) stats.withTextsEn++;
    const out = {};
    for (const [k, v] of Object.entries(level)) {
      if (k === 'textsEn') continue;
      out[k] = v;
      if (k === 'texts' && Object.keys(textsEn).length) out.textsEn = textsEn;
    }
    return out;
  });
  const text = JSON.stringify(data) + '\n';
  return { text, changed: text !== raw, stats };
}
