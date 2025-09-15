import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchArabicVerses } from "./quranApi";
import { fetchTransliteration, roughTransliterate } from "./transliteration";
import { CHAPTERS } from "./last30";
import "./kids.css";

export default function QuizView() {
  const { chapter } = useParams();
  const chapNo = Number(chapter);
  const meta = useMemo(()=>CHAPTERS.find(c=>c.number===chapNo),[chapNo]);

  const [lines, setLines] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [score, setScore] = useState(0);

  useEffect(() => {
    (async () => {
      const ar = await fetchArabicVerses(chapNo);
      let tr = await fetchTransliteration(chapNo);
      if (!tr) tr = ar.map(v => ({ numberInSurah: v.numberInSurah, textTr: roughTransliterate(v.textAr) }));
      const ordered = tr.sort((a,b)=>a.numberInSurah-b.numberInSurah).map(t => t.textTr);
      setLines(ordered); setIdx(0); setAnswer(""); setScore(0);
    })();
  }, [chapNo]);

  const prompt = lines[idx] || "";
  const nextPart = lines[idx+1] || "";

  function check() {
    const ok = normalize(answer) === normalize(nextPart);
    if (ok) setScore(s=>s+1);
    setIdx(i => Math.min(i+1, Math.max(0, lines.length-2)));
    setAnswer("");
  }

  return (
    <div className="k-wrap">
      <Link to={`/kids-suras/${chapNo}`} className="k-back">← Til sura</Link>
      <h1>Quiz: fullfør neste linje</h1>
      <p><b>{meta?.name_en}</b> – skriv neste linje (translitterasjon):</p>
      <div className="k-quiz">
        <div className="k-quiz-prompt">… {prompt}</div>
        <input className="k-input" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Skriv det du husker" />
        <button className="k-btn" onClick={check}>Sjekk</button>
        <div className="k-score">Poeng: {score}</div>
      </div>
    </div>
  );
}

function normalize(s) {
  return (s||"").toLowerCase().replace(/[^a-zāīūḍṣṭẓʿ -]/g,"").replace(/\s+/g," ").trim();
}
