// frontend/src/PushControlsAuto.jsx
import React, { useState } from "react";
import { registerWithMetadata, sendTest, getEndpointInfo } from "./push";

export default function PushControlsAuto({ coords, city, countryCode, tz }) {
  const [status, setStatus] = useState("");

  const handleRegister = async () => {
    try {
      await registerWithMetadata(coords, city, countryCode, tz);
      setStatus("Push-registrering fullført ✅");
    } catch (err) {
      console.error(err);
      setStatus("Feil under registrering ❌");
    }
  };

  const handleSendTest = async () => {
    try {
      await sendTest();
      setStatus("Testvarsel sendt ✅");
    } catch (err) {
      console.error(err);
      setStatus("Feil under test ❌");
    }
  };

  const handleShowEndpoint = async () => {
    try {
      const info = await getEndpointInfo();
      if (info) {
        setStatus(`Endpoint: ${info.endpoint}`);
      } else {
        setStatus("Ingen aktiv push-subscription funnet ❌");
      }
    } catch (err) {
      console.error(err);
      setStatus("Kunne ikke hente endpoint ❌");
    }
  };

  return (
    <div className="push-controls">
      <h3>Push-kontroller (Auto)</h3>
      <button onClick={handleRegister}>Aktiver push</button>
      <button onClick={handleSendTest}>Send test</button>
      <button onClick={handleShowEndpoint}>Vis endpoint</button>
      <p>{status}</p>
    </div>
  );
}
