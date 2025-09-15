import { Link } from "react-router-dom";
import { CHAPTERS } from "./last30";
import "./kids.css";

export default function SurahList() {
  return (
    <div className="k-wrap">
      <h1>🎧 Lær de korte suraene</h1>
      <p>Les arabisk, se translitterasjon og hør resitasjon. Samle stjerner ved å øve daglig.</p>
      <div className="k-grid">
        {CHAPTERS.map((c) => (
          <Link key={c.number} to={`/kids-suras/${c.number}`} className="k-card">
            <div className="k-title">
              <span className="k-ar">{c.name_ar}</span>
              <span className="k-en">{c.name_en || c.short}</span>
            </div>
            <div className="k-meta">Sura {c.number}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
