// frontend/src/AutoLocationModal.jsx
import React from "react";
export default function AutoLocationModal({ open, onAllow, onClose }) {
  if (!open) return null;
  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"grid", placeItems:"center", zIndex:50}}>
      <div style={{background:"rgba(16,24,39,.96)", border:"1px solid #334155", borderRadius:14, padding:18, width:"94%", maxWidth:420}}>
        <h3 style={{marginTop:0}}>Bruk posisjon for bønnetider</h3>
        <p className="hint" style={{marginTop:6}}>Vi trenger posisjonen din for å vise riktig by og oppdatere bønnetider automatisk.</p>
        <div style={{display:"flex", gap:8, marginTop:12, justifyContent:"flex-end"}}>
          <button className="btn" onClick={onClose}>Senere</button>
          <button className="btn btn-green" onClick={onAllow}>Tillat posisjon</button>
        </div>
      </div>
    </div>
  );
}
