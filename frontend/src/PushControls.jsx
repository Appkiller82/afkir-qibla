import React, { useState } from 'react';
import { ensurePushSubscription, unsubscribePush } from './push.ts';

export default function PushControls() {
  const [status, setStatus] = useState('');

  const onEnable = async () => {
    try {
      const ok = await ensurePushSubscription();
      setStatus(ok ? 'Push aktivert' : 'Tillatelse avvist / ikke støttet');
    } catch (e) {
      console.error(e);
      setStatus('Feil ved aktivering');
    }
  };

  const onDisable = async () => {
    try {
      await unsubscribePush();
      setStatus('Push slått av');
    } catch (e) {
      console.error(e);
      setStatus('Feil ved deaktivering');
    }
  };

  const onSendTest = async () => {
    try {
      const res = await fetch('/.netlify/functions/send-test', { method: 'POST' });
      setStatus(`Send-test: ${res.status}`);
    } catch (e) {
      console.error(e);
      setStatus('Feil ved send-test');
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>Push-varsler</h3>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={onEnable}>Aktiver push</button>
        <button className="btn" onClick={onSendTest}>Send test</button>
        <button className="btn" onClick={onDisable}>Skru av</button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>{status}</div>
    </div>
  );
}
