
import React, { useState, useEffect, useRef } from 'react';
import { PrayerTimes, CalculationMethod, Prayer } from 'adhan';

export default function App() {
  const [location, setLocation] = useState(null);
  const [heading, setHeading] = useState(0);
  const [qiblaDirection, setQiblaDirection] = useState(null);
  const [prayerTimes, setPrayerTimes] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const audioRef = useRef(null);

  // Get location
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setLocation(coords);
        updatePrayerTimes(coords);
        updateQibla(coords);
      },
      (err) => console.error(err),
      { enableHighAccuracy: true }
    );
  }, []);

  // Device orientation for compass
  useEffect(() => {
    const handler = (e) => {
      if (e.absolute && e.alpha !== null) {
        setHeading(e.alpha);
      }
    };
    window.addEventListener('deviceorientationabsolute', handler, true);
    return () => window.removeEventListener('deviceorientationabsolute', handler);
  }, []);

  function updateQibla(coords) {
    // Qibla direction calculation (simplified)
    const kaabaLat = 21.4225 * Math.PI / 180;
    const kaabaLon = 39.8262 * Math.PI / 180;
    const lat = coords.lat * Math.PI / 180;
    const lon = coords.lon * Math.PI / 180;
    const dLon = kaabaLon - lon;
    const y = Math.sin(dLon) * Math.cos(kaabaLat);
    const x = Math.cos(lat) * Math.sin(kaabaLat) - Math.sin(lat) * Math.cos(kaabaLat) * Math.cos(dLon);
    const brng = Math.atan2(y, x);
    const brngDeg = (brng * 180 / Math.PI + 360) % 360;
    setQiblaDirection(brngDeg);
  }

  function updatePrayerTimes(coords) {
    const params = CalculationMethod.MoonsightingCommittee();
    params.madhab = 'Shafi'; // Maliki closest
    const date = new Date();
    const pt = new PrayerTimes(
      { latitude: coords.lat, longitude: coords.lon },
      date,
      params
    );
    setPrayerTimes({
      fajr: pt.fajr.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      sunrise: pt.sunrise.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      dhuhr: pt.dhuhr.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      asr: pt.asr.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      maghrib: pt.maghrib.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      isha: pt.isha.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
    });
  }

  function handlePushToggle() {
    const newState = !pushEnabled;
    setPushEnabled(newState);
    // TODO: connect to backend push registration
  }

  function playAdhan() {
    audioRef.current.play();
  }

  const rotation = qiblaDirection !== null ? (heading - qiblaDirection) : 0;

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <h1>Afkir Qibla App</h1>

      {prayerTimes && (
        <div>
          <h2>Bønnetider</h2>
          <ul>
            <li>Fajr: {prayerTimes.fajr}</li>
            <li>Soloppgang: {prayerTimes.sunrise}</li>
            <li>Dhuhr: {prayerTimes.dhuhr}</li>
            <li>Asr: {prayerTimes.asr}</li>
            <li>Maghrib: {prayerTimes.maghrib}</li>
            <li>Isha: {prayerTimes.isha}</li>
          </ul>
        </div>
      )}

      <div style={{ marginTop: '2rem' }}>
        <h2>Qibla Kompass</h2>
        <div style={{
          position: 'relative',
          width: '200px',
          height: '200px',
          margin: 'auto',
          border: '5px solid #333',
          borderRadius: '50%',
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.2s linear'
        }}>
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '2rem'
          }}>🕋</div>
        </div>
        {qiblaDirection !== null && (
          <p>Qibla-retning: {Math.round(qiblaDirection)}°</p>
        )}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <button 
          onClick={handlePushToggle} 
          style={{ backgroundColor: pushEnabled ? 'green' : 'gray', color: 'white', padding: '0.5rem 1rem', border: 'none' }}
        >
          {pushEnabled ? 'Push-varsler aktivert' : 'Aktiver push-varsler'}
        </button>
        <button onClick={playAdhan} style={{ marginLeft: '1rem', padding: '0.5rem 1rem' }}>
          Spill Adhan
        </button>
        <audio ref={audioRef} src="/audio/adhan.mp3" />
      </div>
    </div>
  );
}
