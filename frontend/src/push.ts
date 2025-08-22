// frontend/src/push.ts (patched)
export async function sendTest() {
  if (!('serviceWorker' in navigator)) throw new Error('No SW');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Mangler subscription – aktiver push først');

  const res = await fetch('/.netlify/functions/send-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subscription: sub,
      pushSubId: localStorage.getItem('pushSubId') || null
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return true;
}

// Du har sikkert flere funksjoner her (enablePush, registerWithMetadata osv.)
// De beholdes som før – bare oppdatert sendTest er vist her.
