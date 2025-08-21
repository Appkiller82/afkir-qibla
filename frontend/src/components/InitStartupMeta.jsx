// frontend/src/components/InitStartupMeta.jsx
import { useEffect } from 'react'
import { loadMeta } from '../lib/persist'
import { updateMetaIfSubscribed } from '../push'

// Mount denne én gang i App-roten. Gjør ingen UI – bare sørger for at lagret meta pusher opp til server.
export default function InitStartupMeta() {
  useEffect(() => {
    const m = loadMeta()
    if (m) {
      updateMetaIfSubscribed(m).catch(() => {})
    }
  }, [])
  return null
}
