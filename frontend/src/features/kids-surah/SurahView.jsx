import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchArabicVerses, chapterAudioUrl } from "./quranApi";
import { fetchTransliteration, roughTransliterate } from "./transliteration";
import useRepeatAudio from "./useRepeatAudio";
import { CHAPTERS } from "./last30";
import "./kids.css";

export default function SurahView() {
  const { chapter } = useParams();
  const chapNo = Number(chapter);
  const meta = useMemo(() => CHAPTERS.find(c => c.number === chapNo), [chapNo]);

  const [versesAr, setVersesAr] = useState([]);
  const [trMap, setTrMap] = useState({});
  const [rate, setRate] = useState(1.0);

  const audio = chapterAudioUrl(chapNo);
  const { play, pause, isPlaying, setRate: setAudioRate } = useRepeatAudio(audio, { rate });

  useEffect(() => {
    (async () => {
      const ar = await fetchArabicVerses(chapNo);
      setVersesAr(ar);
      let tr = await fetchTransliteration(chapNo);
      if (!tr) tr = ar.map(v => ({ numberInSurah: v.numberInSurah, textTr: roughTransliterate(v.textAr) }));
      const map = {};
      tr.forEach(t => { map[t.numberInSurah] = t.textTr; });
      setTrMap(map);
    })();
  }, [chapNo]);

  const key = `kids-surah-progress-${chapNo}`;
  const today = new Date().toISOString().slice(0,10);
  const [checked, setChecked] = useState(localStorage.getItem(key) === today);
  const toggleDone = () => {
    const nv = !checked; setChecked(nv);
    if (nv) localStorage.setItem(key, today); else localStorage.removeItem(key);
  };

  return (
    <div className="k-wrap">
      <Link to="/kids-suras" className="k-back">← Tilbake</Link>
      <h1 className="k-h1">
        <span className="k-ar">{meta?.name_ar || "سورة"}</span>
        <small className="k-en">{meta?.name_en}</small>
      </h1>

      <div className="k-audio">
        <button onClick={isPlaying ? pause : play} className="k-btn">{isPlaying ? "Pause" : "Spill av hel sura"}</button>
        <label className="k-rate">
          Hastighet:
          <select value={rate} onChange={(e)=>{ const r=Number(e.target.value); setRate(r); setAudioRate(r); }}>
            <option value="0.8">0.8×</option>
            <option value="1">1×</option>
            <option value="1.2">1.2×</option>
          </select>
        </label>
        <label className="k-done"><input type="checkbox" checked={checked} onChange={toggleDone}/> Øvd i dag ⭐</label>
      </div>

      <div className="k-ayahs">
        {versesAr.map(v => (
          <div key={v.key} className="k-ayah">
            <div className="k-ayah-num">{v.numberInSurah}</div>
            <div className="k-ayah-ar">{v.textAr}</div>
            <div className="k-ayah-tr">{trMap[v.numberInSurah] || "…"}</div>
            <button className="k-mini-btn" onClick={() => speakLine(trMap[v.numberInSurah])}>🔁 Gjenta</button>
          </div>
        ))}
      </div>

      <div className="k-actions">
        <Link to={`/kids-suras/${chapNo}/quiz`} className="k-btn k-alt">Quiz: fullfør vers</Link>
      </div>
    </div>
  );
}

function speakLine(text) {
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
