const CDN = "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions";
const CANDIDATES = ["ara-quran-la", "eng-transliteration-la"];

export async function fetchTransliteration(chapter) {
  for (const ed of CANDIDATES) {
    try {
      const u = `${CDN}/${ed}/${chapter}.min.json`;
      const r = await fetch(u);
      if (!r.ok) continue;
      const j = await r.json();
      const verses = j.verses || j.ayahs || [];
      const out = verses.map((v, i) => ({
        numberInSurah: v.numberInSurah || v.aya || v.verse_number || i + 1,
        textTr: (v.text || v.translation || v.transliteration || "").toString()
      }));
      if (out.length) return out;
    } catch {}
  }
  return null;
}

const MAP = {
  "ا":"a","أ":"a","إ":"i","آ":"ā","ب":"b","ت":"t","ث":"th","ج":"j","ح":"ḥ","خ":"kh",
  "د":"d","ذ":"dh","ر":"r","ز":"z","س":"s","ش":"sh","ص":"ṣ","ض":"ḍ","ط":"ṭ","ظ":"ẓ",
  "ع":"ʿ","غ":"gh","ف":"f","ق":"q","ك":"k","ل":"l","م":"m","ن":"n","ه":"h","و":"w","ي":"y",
  "َ":"a","ِ":"i","ُ":"u","ً":"an","ٍ":"in","ٌ":"un","ْ":"","ّ":""
};
export function roughTransliterate(ar) {
  return [...ar].map(ch => MAP[ch] ?? ch).join("").replace(/\s+/g," ").trim();
}
