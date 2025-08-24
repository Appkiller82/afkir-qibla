// frontend/src/PushControls.jsx
import React, { useState } from 'react';
import { enablePush, sendTest, getEndpointInfo, getEndpointInfo } from './push';

export default function PushControls() {
  const [status, setStatus] = useState('');
  const subId = (typeof window !== 'undefined' && localStorage.getItem('pushSubId')) || null;

  async function onEnable() {
    setStatus('Aktiverer …');
    try {
      const id = await enablePush();
      setStatus(`Aktivert. ID: ${id.slice(0, 10)}…`);
    } catch (e) {
      console.error(e);
      setStatus(`Feil ved aktivering: ${e.message}`);
    }
  }

  async function onSend() {
    setStatus('Sender test …');
    try {
      const msg = await sendTest();
      setStatus(`Sendt: ${msg}`);
    } catch (e) {
      console.error(e);
      setStatus(`Send-test feilet: ${e.message}`);
    }
  }

  function onDisable() {
    localStorage.removeItem('pushSubId');
    setStatus('Skrudd av lokalt.');
  }

  async function onDebug() {
    try {
      const info = await getEndpointInfo();
      alert(`Apple endpoint: ${info.endpointIsApple}\n${info.endpoint || 'no subscription'}`);
    } catch (e) {
      alert('Debug fail: ' + (e?.message || e));
    }
  }

  return (
    <div className="space-x-2">
      <button onClick={onEnable}>Aktiver push</button>
      <button onClick={onSend}>Send test</button>
      <button onClick={onDisable}>Skru av</button>
      <button onClick={onDebug}>Vis push-debug</button>
      <div style={{ marginTop: 8, opacity: 0.8 }}>
        {status || (subId ? `Lagret ID: ${subId.slice(0, 10)}…` : 'Ingen lagret ID')}
      </div>
    </div>
  );
}
