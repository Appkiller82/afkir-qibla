// frontend/src/components/CompassGate.jsx
import { useEffect, useState } from 'react';
import { wasEverGranted, requestCompassPermission, armOneTapAutoRegrant } from '../lib/compass-perm';

export default function CompassGate({ onGranted }) {
  const [show, setShow] = useState(() => !wasEverGranted());

  useEffect(() => {
    // Armér auto re-grant ved oppstart (hvis tidligere godkjent)
    armOneTapAutoRegrant(() => { onGranted?.(); });
  }, [onGranted]);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-3 mx-auto w-[92%] max-w-md rounded-xl shadow-lg bg-white/90 dark:bg-zinc-900/90 p-3 backdrop-blur z-50 border border-zinc-200/50 dark:border-zinc-700/50">
      <div className="text-sm mb-2">
        Aktiver kompass for Qibla-retning (trengs kun én gang).
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-lg px-3 py-2 bg-black text-white dark:bg-white dark:text-black"
          onClick={async () => {
            const s = await requestCompassPermission();
            if (s === 'granted') { setShow(false); onGranted?.(); }
          }}
        >
          Aktiver kompass
        </button>
        <button
          className="px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800"
          onClick={() => setShow(false)}
        >
          Senere
        </button>
      </div>
    </div>
  );
}
