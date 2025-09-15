const BASE = "https://api.quran.com/api/v4";

export async function fetchArabicVerses(chapter) {
  const url = `${BASE}/verses/by_chapter/${chapter}?fields=text_uthmani&per_page=50&page=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Kunne ikke hente arabisk tekst");
  const j = await r.json();
  return (j.verses || []).map(v => ({
    key: v.verse_key,
    numberInSurah: v.verse_number,
    textAr: v.text_uthmani
  }));
}

export function chapterAudioUrl(chapter, bitrate = 128, edition = "ar.alafasy") {
  return `https://cdn.islamic.network/quran/audio-surah/${bitrate}/${edition}/${chapter}.mp3`;
}
