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
      } finally {
        setLoading(false);
      }
    })();
  }, [coords?.latitude, coords?.longitude]);

  if (!coords) return <div>Venter på posisjon…</div>;
  if (loading) return <div>Laster bønnetider…</div>;
  if (error) return <div style={{ color: "crimson" }}>Feil: {error}</div>;
  if (!data) return null;

  return (
    <section className="card">
      <h3>Bønnetider (i dag)</h3>
      <ul>
        <li>Fajr: {data.Fajr || "-"}</li>
        <li>Soloppgang: {data.Sunrise || "-"}</li>
        <li>Dhuhr: {data.Dhuhr || "-"}</li>
        <li>Asr: {data.Asr || "-"}</li>
        <li>Maghrib: {data.Maghrib || "-"}</li>
        <li>Isha: {data.Isha || "-"}</li>
      </ul>
    </section>
  );
}
