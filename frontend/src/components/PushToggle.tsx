
import React, { useEffect, useState } from 'react'
import { subscribeForPush, unsubscribeFromPush, ensureSW } from '../lib/push'

export default function PushToggle() {
  const [enabled, setEnabled] = useState<boolean>(false)
  const [checking, setChecking] = useState<boolean>(true)
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    (async () => {
      try {
        const reg = await ensureSW()
        const sub = await reg.pushManager.getSubscription()
        setEnabled(!!sub)
      } catch {}
      setChecking(false)
    })()
  }, [])

  async function onToggle() {
    setMessage('')
    try {
      if (!enabled) {
        await subscribeForPush(true) // send a one-time confirmation
        setEnabled(true)
        setMessage('Varsler aktivert ✅')
      } else {
        await unsubscribeFromPush()
        setEnabled(false)
        setMessage('Varsler deaktivert')
      }
    } catch (e:any) {
      console.error(e)
      setMessage('Feil: ' + (e?.message || 'ukjent'))
    }
  }

  return (
    <div>
      <button onClick={onToggle} disabled={checking} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #d1d5db'}}>
        {enabled ? 'Slå av varsler' : 'Slå på varsler'}
      </button>
      {message && <div style={{marginTop:8}}>{message}</div>}
    </div>
  )
}
