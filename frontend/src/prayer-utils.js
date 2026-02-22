const HHMM_RE = /^(\d{1,2}):(\d{2})/;

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function normalizeHHMM(value) {
  if (value == null) return "";
  const s = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  if (/^\d{1,2}\.\d{2}$/.test(s)) {
    const [h, m] = s.split(".").map(Number);
    return `${pad2(h)}:${pad2(m)}`;
  }
  const match = s.match(HHMM_RE);
  return match ? `${pad2(Number(match[1]))}:${pad2(Number(match[2]))}` : "";
}

export function applyOffset(hhmm, minutes) {
  const m = String(hhmm || "").match(HHMM_RE);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  const total = h * 60 + min + Number(minutes || 0);
  const dayMinutes = 24 * 60;
  const wrapped = ((total % dayMinutes) + dayMinutes) % dayMinutes;
  const outH = Math.floor(wrapped / 60);
  const outM = wrapped % 60;
  return `${pad2(outH)}:${pad2(outM)}`;
}

export function assertDistinctMaghribIsha(day) {
  if (!day) return true;
  if (!day.maghrib || !day.isha) return true;
  return normalizeHHMM(day.maghrib) !== normalizeHHMM(day.isha);
}

