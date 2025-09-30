import { useEffect, useState } from "react";
import { fetchBonnetid } from "../lib/bonnetid";

type Coords = { latitude: number; longitude: number };
export default function PrayerTimesCard({ coords }: { coords: Coords | null }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!coords) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchBonnetid(coords.latitude, coords.longitude, "today");
        setData(res);
      } catch (e: any) {
        setError(e?.message || "Feil ved henting av bønnetider");
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [coords?.latitude, coords?.longitude]);

  if (!coords) return <div>Venter på posisjon…</div>;
  if (loading) return <div>Laster bønnetider…</div>;
  if (error) return <div style={{ color: "crimson" }}>Feil: {error}</div>;
  if (!data) return null;

  const get = (k: string) => (data && data[k]) || "–";

  return (
    <section className="card">
      <h3>Bønnetider (i dag)</h3>
      <ul>
        <li>Fajr: {get("Fajr")}</li>
        <li>Soloppgang: {get("Sunrise")}</li>
        <li>Dhuhr: {get("Dhuhr")}</li>
        <li>Asr: {get("Asr")}</li>
        <li>Maghrib: {get("Maghrib")}</li>
        <li>Isha: {get("Isha")}</li>
      </ul>
    </section>
  );
}