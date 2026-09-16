import React, { useState } from "react";
import Icon from "./Icon.jsx";

const pages = [["home", "Hjem", "home"], ["qibla", "Qibla", "compass"], ["calendar", "Kalender", "calendar"], ["more", "Mer", "more"]];
const prayers = ["Fajr", "Soloppgang", "Dhuhr", "Asr", "Maghrib", "Isha"];
const prayerIcons = ["moon", "sun", "sun", "sun", "sun", "moon"];
const imageNames = ["Mekka i skumringen", "Mekka ved daggry", "Mekka om natten"];

export default function AppView(p) {
  const [weatherExpanded, setWeatherExpanded] = useState(false);
  const [audioStatus, setAudioStatus] = useState("");
  const changePage = (next) => {
    p.setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const toggleAdhan = async () => {
    if (!p.remindersOn) {
      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch {}
      }
      try { await p.audioRef.current?.play(); p.audioRef.current?.pause(); if (p.audioRef.current) p.audioRef.current.currentTime = 0; } catch {}
    }
    p.setRemindersOn(v => !v);
  };
  const testAdhan = async () => {
    const audio = p.audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); audio.currentTime = 0; setAudioStatus(""); return; }
    try { audio.currentTime = 0; await audio.play(); setAudioStatus("Spiller Adhan"); }
    catch { setAudioStatus("Lyden kunne ikke spilles. Prøv igjen og sjekk lydinnstillingene."); }
  };

  const backgrounds = <section className="card background-card">
    <div className="section-heading"><Icon name="image"/><h2>Gjør appen din</h2></div>
    <p className="hint">Et lite glimt av Mekka i hverdagen.</p>
    <div className="background-options">{p.bgList.map((src, i) => <button key={src} className={`background-option ${p.bg === src ? "selected" : ""}`} aria-label={`Velg ${imageNames[i] || "bakgrunn"}`} aria-pressed={!p.rotateBackground && p.bg === src} onClick={() => { p.setSelectedBackground(src); p.setRotateBackground(false); }}><img src={src} alt={imageNames[i] || "Mekka"} loading="lazy"/><span>{["Skumring", "Daggry", "Natt"][i] || "Mekka"}</span></button>)}</div>
    <label className="setting-row"><span><strong>Tilfeldig bakgrunn</strong><small>Nytt bilde ved åpning og rolig bildebytte</small></span><input type="checkbox" role="switch" checked={p.rotateBackground} onChange={e => p.setRotateBackground(e.target.checked)} /></label>
    <p className="fine-print">Bakgrunnene er KI-genererte illustrasjoner av Mekka.</p>
  </section>;

  const location = <section className="card location-card">
    <div className="section-heading"><Icon name="pin"/><h2>Plassering</h2></div>
    <p>{p.city || "Oslo"}{!p.coords && !p.lastCoords ? " · standardplassering" : ""}</p>
    <p className="hint">{p.permission === "denied" ? "Posisjon er blokkert. Du kan gi tilgang i nettleserens innstillinger." : "Bruk posisjonen din for lokale bønnetider og Qibla-retning."}</p>
    <button className="btn" onClick={p.onUseLocation} disabled={p.loading}><Icon name="pin" size={18}/>{p.loading ? "Henter posisjon…" : "Bruk stedstjenester"}</button>
    {p.activeCoords && <p className="fine-print">{p.activeCoords.latitude.toFixed(4)}, {p.activeCoords.longitude.toFixed(4)}</p>}
  </section>;

  return <div className={`app-shell ${p.quranMode ? "quiet-mode" : ""}`}>
    <div className="app-container">
      <header className="app-header">
        <a href="#home" className="brand" onClick={e => { e.preventDefault(); changePage("home"); }}><img src="/icons/kaaba.svg" width="30" height="30" alt=""/><span>Afkir Qibla</span></a>
        <div className="header-actions"><span className="desktop-date">{p.NB_DAY.format(new Date())}</span><button className="icon-button" aria-label={p.theme === "dark" ? "Bytt til lyst tema" : "Bytt til mørkt tema"} onClick={() => p.setTheme(t => t === "dark" ? "light" : "dark")}><Icon name={p.theme === "dark" ? "sun" : "moon"}/></button></div>
      </header>
      {p.offline && <div className="notice" role="status">Du er frakoblet. Tilgjengelige lagrede tider vises.</div>}

      <main id="main-content">
        {p.prayerSource && <p className="fine-print" aria-label="Kilde for bønnetider">Bønnetider: {p.prayerSource}</p>}
        {p.page === "home" && <div className="home-layout">
          <section className="hero-card" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,25,22,.86), rgba(5,25,22,.14)), linear-gradient(0deg, rgba(5,25,22,.70), transparent 65%), url("${p.bg}")` }}>
            <div className="hero-location"><Icon name="pin" size={17}/>{p.city || "Oslo"}{!p.coords && !p.lastCoords && <span>· standardplassering</span>}</div>
            <div className="hero-prayer"><div className="eyebrow">{p.countdown.tomorrow ? "Neste bønn · i morgen" : "Neste bønn"}</div><h1>{p.countdown.name || (p.apiError ? "Tider utilgjengelige" : "Et øyeblikk…")}</h1><div className="hero-time">{p.countdown.atText || (p.countdown.at ? p.formatPrayerTime(p.countdown.at) : "--:--")}</div><div className="countdown">{p.countdown.diffText ? `Om ${p.countdown.diffText}` : "Henter lokale bønnetider"}</div></div>
            <div className="hero-bottom"><span>{p.NB_DAY.format(new Date())}</span><button onClick={() => changePage("qibla")} className="hero-qibla"><Icon name="compass" size={18}/> Qibla {p.qiblaDeg != null ? `${Math.round(p.qiblaDeg)}°` : ""}<Icon name="arrow" size={14}/></button></div>
          </section>

          <section className="card prayer-card"><div className="section-heading spaced"><h2>Dagens bønnetider</h2><Icon name="sun" size={20}/></div>
            {p.apiError && <div className="notice" role="status">{p.apiError}</div>}
            <ul className="prayer-list">{prayers.map((name, i) => <li key={name} className={`prayer-row ${!p.countdown.tomorrow && p.countdown.name === name ? "next-prayer" : ""}`}><Icon name={prayerIcons[i]} size={21}/><span>{name}</span>{!p.countdown.tomorrow && p.countdown.name === name && <small>Neste</small>}<time>{p.timesText?.[name] || (p.times ? p.formatPrayerTime(p.times[name]) : "--:--")}</time></li>)}</ul>
            <div className="prayer-actions"><button className={`btn ${p.remindersOn ? "btn-gold" : ""}`} aria-pressed={p.remindersOn} onClick={toggleAdhan}><Icon name="bell" size={18}/>Adhan {p.remindersOn ? "på" : "av"}</button><button className="text-button" onClick={testAdhan}>{audioStatus === "Spiller Adhan" ? "Stopp Adhan" : "Test Adhan"}</button></div>
            {audioStatus && <p className="hint" role="status">{audioStatus}</p>}
          </section>

          <section className="card weather-card"><button className="weather-summary" aria-expanded={weatherExpanded} onClick={() => setWeatherExpanded(v => !v)}><span className="weather-symbol" aria-hidden="true">{p.weatherIcon(p.weather?.code)}</span><span><strong>{p.city || "Oslo"} · {p.formatMetric(p.weather?.currentTemp, "°")}</strong><small>{p.weather ? p.weatherCodeToText(p.weather.code) : "Henter værdata…"}</small></span><Icon name="arrow" size={18}/></button>
            {weatherExpanded && <div className="weather-details"><div className="segmented"><button className={p.weatherTab === "now" ? "active" : ""} onClick={() => p.setWeatherTab("now")}>Nå</button><button className={p.weatherTab === "long" ? "active" : ""} onClick={() => p.setWeatherTab("long")}>Langtidsvarsel</button></div>{p.weatherError && <p role="status" className="notice">{p.weatherError}</p>}{p.weather && p.weatherTab === "now" && <p className="hint">Føles som {p.formatMetric(p.weather.feelsLike, "°")} · Vind {p.formatMetric(p.weather.wind, " km/t")}<br/>Min/maks {p.formatMetric(p.weather.min, "°")} / {p.formatMetric(p.weather.max, "°")}</p>}{p.weather && p.weatherTab === "long" && <ul className="forecast-list">{p.weather.daily?.slice(0, 7).map(day => <li key={day.date}><span>{p.formatForecastDate(day.date)}</span><span>{p.weatherIcon(day.code)} {p.formatMetric(day.min, "°")} / {p.formatMetric(day.max, "°")}</span></li>)}</ul>}</div>}
          </section>
          <div className="home-links"><button className="card link-card" onClick={() => changePage("qibla")}><Icon name="compass"/><span><strong>Vend deg mot Kaba</strong><small>Kompass og kart</small></span><Icon name="arrow" size={18}/></button><button className="card link-card" onClick={() => changePage("calendar")}><Icon name="calendar"/><span><strong>Planlegg dagene dine</strong><small>Månedskalender</small></span><Icon name="arrow" size={18}/></button></div>
          <div className="home-location">{location}</div>
        </div>}

        {p.page === "qibla" && <><div className="page-heading"><div className="eyebrow">Retning mot Mekka</div><h1>Qibla</h1><p>Finn retningen mot Kaba fra {p.city || "din posisjon"}.</p></div><div className="two-column"><section className="card compass-card"><p className="compass-location"><Icon name="pin" size={16}/>{p.city || "Oslo"}</p><p.ModernCompass bearing={p.qiblaDeg}/><div className="bearing">{p.qiblaDeg != null ? `${Math.round(p.qiblaDeg)}°` : "--"}</div><p className="hint centered">Fra geografisk nord</p><button className="btn full-width" aria-expanded={p.showMap} onClick={() => p.setShowMap(v => !v)}><Icon name="compass" size={18}/>{p.showMap ? "Skjul kart" : "Vis kart"}</button>{p.showMap && <div className="map-panel"><p.QiblaMap coords={p.activeCoords}/><p className="hint">Linjen viser retningen fra din posisjon til Kaba i Mekka.</p></div>}</section><div className="stack">{backgrounds}{location}</div></div></>}

        {p.page === "calendar" && <><div className="page-heading"><div className="eyebrow">En dag om gangen</div><h1>Månedskalender</h1><p>{p.city || "Oslo"} · {new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric" }).format(new Date())}</p></div><section className="card calendar-card"><div className="section-heading spaced"><h2>Bønnetider denne måneden</h2><button className="btn" disabled={!p.calendarRows.length} onClick={() => p.exportCalendarIcs(p.city, p.calendarRows)}><Icon name="download" size={18}/>Last ned kalender</button></div>{p.calendarError && <p className="notice" role="status">{p.calendarError}</p>}{!p.calendarRows.length && !p.calendarError && <p className="hint">Henter månedskalender…</p>}<div className="calendar-scroll" tabIndex={0} role="region" aria-label="Bønnetider for måneden"><table className="calendar-table"><thead><tr>{["Dato", "Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map(v => <th scope="col" key={v}>{v}</th>)}</tr></thead><tbody>{p.calendarRows.map(row => <tr key={row.date} className={row.date === p.todayIsoForView ? "today-row" : ""}><th scope="row">{p.formatCalendarDate(row.date)}{row.date === p.todayIsoForView && <small>I dag</small>}</th>{["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map(k => <td key={k}>{row.timings[k] || "--:--"}</td>)}</tr>)}</tbody></table></div></section></>}

        {p.page === "more" && <><div className="page-heading"><div className="eyebrow">Din hverdag, ditt uttrykk</div><h1>Mer</h1><p>Tilpass Afkir Qibla slik du liker den.</p></div><div className="two-column"><div className="stack">{backgrounds}<section className="card"><div className="section-heading"><Icon name="sun"/><h2>Utseende</h2></div><label className="setting-row"><span><strong>Mørkt tema</strong><small>Rolige grønntoner og varme detaljer</small></span><input type="checkbox" role="switch" checked={p.theme === "dark"} onChange={e => p.setTheme(e.target.checked ? "dark" : "light")}/></label></section>{location}</div><div className="stack"><section className="card"><div className="section-heading"><Icon name="bell"/><h2>Adhan og varsler</h2></div><label className="setting-row"><span><strong>Spill Adhan</strong><small>Påminnelser mens appen er åpen</small></span><input type="checkbox" role="switch" checked={p.remindersOn} onChange={toggleAdhan}/></label><button className="btn" onClick={testAdhan}>{audioStatus === "Spiller Adhan" ? "Stopp Adhan" : "Test Adhan"}</button>{audioStatus && <p className="hint" role="status">{audioStatus}</p>}<div className="divider"/><h3>Push-varsler</h3><p className="hint">Administrer varsler på denne enheten.</p><p.PushControlsAuto coords={p.coords} city={p.city} countryCode={p.effectiveCountryCode} tz={p.timeZone}/></section><section className="card"><div className="section-heading"><Icon name="book"/><h2>Quran og dhikr</h2></div><label className="setting-row"><span><strong>Stille modus</strong><small>Korte påminnelser for en rolig stund</small></span><input type="checkbox" role="switch" checked={p.quranMode} onChange={e => p.setQuranMode(e.target.checked)}/></label>{p.quranMode && <ul className="dhikr-list"><li><span>Hasbunallahu wa ni'mal wakeel</span><strong>× 7</strong></li><li><span>Astaghfirullah</span><strong>× 33</strong></li><li>Surah Al-Ikhlas, Al-Falaq og An-Nas før søvn.</li></ul>}</section></div></div></>}
      </main>
      <footer className="app-footer">Afkir Qibla <span>·</span> Et øyeblikk for tro i hverdagen</footer>
      <nav className="bottom-nav" aria-label="Hovedmeny">{pages.map(([id, label, icon]) => <button key={id} aria-current={p.page === id ? "page" : undefined} className={p.page === id ? "active" : ""} onClick={() => changePage(id)}><Icon name={icon}/><span>{label}</span></button>)}</nav>
    </div>
    <audio ref={p.audioRef} preload="none" src="/audio/adhan.mp3" onEnded={() => setAudioStatus("")}/>
    <p.AutoLocationModal open={p.showModal} onAllow={p.allowLocation} onClose={() => p.setShowModal(false)}/>
  </div>;
}

