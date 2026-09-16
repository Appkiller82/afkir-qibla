// frontend/src/AutoLocationModal.jsx
import React from "react";
import Dialog from "./Dialog.jsx";
export default function AutoLocationModal({ open, onAllow, onClose }) {
  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} title="Bønnetider der du er">
        <p className="hint" style={{marginTop:6}}>Vi trenger posisjonen din for å vise riktig by og oppdatere bønnetider automatisk.</p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Senere</button>
          <button className="btn btn-green" onClick={onAllow}>Tillat posisjon</button>
        </div>
    </Dialog>
  );
}
