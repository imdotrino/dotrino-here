// Puente al registro de reputación (@dotrino/reputation, backend rep.dotrino.com).
//
// Lo usa el modal de perfil que abre <dotrino-topbar> (§6.1): la tarjeta de
// perfil muestra reputación, y el paquete la pondera con el web-of-trust local
// del vault (anti-sybil). No inventamos score propio ni reimplementamos nada.

import { createVaultReputation } from '@dotrino/reputation'
import { initIdentity } from './identity'

let _rep = null

/** Instancia compartida de reputación (o null si no hay vault). Idempotente. */
export async function getReputation () {
  if (_rep) return _rep
  const identity = await initIdentity()
  if (!identity) return null
  try { _rep = createVaultReputation(identity) } catch (e) {
    console.warn('[here] reputación inalcanzable:', e && e.message)
    _rep = null
  }
  return _rep
}
