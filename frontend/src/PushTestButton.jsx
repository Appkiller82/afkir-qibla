// frontend/src/PushTestButton.jsx
import { useState } from "react";

export default function PushTestButton() {
  const [pin, setPin] = useState("");
  const [ok, setOk] = useState(false);
  const [title, setTitle] = useState("Qibla melding");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");

  function unlock(e) {
    e.preventDefault();
    if ((pin || "").trim() === "0199") {
      setOk(true);
      setStatus("");
    } else {
      setStatus("❌ Feil kode");
    }
  }

  function fillEid() {
    setTitle("God Eid ✨");
    setText("God Eid! Må Allah akseptere våre gjerninger og gi deg og familien velsignelse og glede.");
  }

  async function send() {
    setStatus("Sender…");
    try {
      const res = await fetch("/.netlify/functions/push-send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (title || "Qibla melding").slice(0, 80),
          body: (text || "Testvarsel").slice(0, 500),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(`✅ Sendt: ${data.sent ?? 0} | Fjernet: ${data.removed ?? 0}`);
      } else {
        setStatus(`❌ Feil: ${data.error || "ukjent feil"}`);
      }
    } catch (err) {
      console.error(err);
      setStatus("❌ Nettverksfeil");
    }
  }

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px dashed var(--border)", borderRadius: 12 }}>
      {!ok ? (
        <form onSubmit={unlock} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Admin-kode"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", width: 140, background: "var(--btn)", color: "var(--fg)" }}
          />
          <button type="submit" className="btn">Åpne</button>
          {status && <span className="hint">{status}</span>}
        </form>
      ) : (
        <div>
          <div className="hint" style={{ marginBottom: 6 }}>
            Admin: Send push til <b>alle</b> lagrede abonnenter.
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <input
              type="text"
              placeholder="Tittel (f.eks. God Eid ✨)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--btn)", color: "var(--fg)" }}
            />
            <textarea
              placeholder="Skriv meldingstekst her…"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--btn)", color: "var(--fg)", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={fillEid}>Fyll: God EID</button>
              <button type="button" className="btn btn-green" onClick={send}>Send push til alle</button>
            </div>
            {status && <div className="hint">{status}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
