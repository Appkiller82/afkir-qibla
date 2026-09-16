import React, { useEffect, useId, useRef } from "react";

export default function Dialog({ open, onClose, title, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const dialog = ref.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector("button")?.focus();
    const keydown = e => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key !== "Tab") return;
      const elements = dialog?.querySelectorAll('button:not(:disabled), a[href], input, [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = oldOverflow; previous?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return <div className="modal-backdrop"><section ref={ref} className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId}><h2 id={titleId}>{title}</h2>{children}</section></div>;
}
