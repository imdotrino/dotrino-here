// Integración con el vault de identidad (id.dotrino.com) y con la primitiva de
// DELEGACIÓN de capacidades (dotrino-identity v0.10.0).
//
// "here" es un CONFIGURADOR: arma círculos, emite caps firmados por el vault y
// genera la config de OwnTracks. Toda firma sale del vault (clave maestra ECDSA
// P-256); este módulo NO guarda claves privadas de identidad.
//
// La identidad es la ÚNICA fuente de identidad del ecosistema (ver CLAUDE.md):
// no reimplementamos firma, challenge/response ni contactos a mano.

import { Identity } from '@dotrino/identity'
// Subpath ESM puro de capacidades (sin iframe): mismas funciones que usa el bridge.
import { makeDeviceKey, pubkeyId } from '@dotrino/identity/capabilities'

let identity = null
let myPubkey = null

/** Conecta al vault (iframe id.dotrino.com). Idempotente. */
export async function initIdentity () {
  if (identity) return identity
  try {
    identity = await Identity.connect()
    myPubkey = identity.me?.publickey || null
  } catch (e) {
    console.warn('[here] vault inalcanzable; modo standalone:', e.message)
    identity = null
  }
  return identity
}

export function getIdentity () { return identity }
export function getMyPubkey () { return myPubkey }
export function isIdentityReady () { return identity !== null }

/** Mi displayName desde el vault (NUNCA copia paralela en localStorage). */
export function getMyName () { return identity?.me?.nickname || identity?.me?.displayName || '' }

// ── Contactos del vault ──────────────────────────────────────────────────────
// Para "agregar miembros desde contactos del vault" en la pantalla de Círculos.
// Reusa la lista compartida del ecosistema (chat/chess/messenger ven lo mismo).

/** Lista los contactos del vault. Devuelve [] si no hay vault. */
export async function listVaultContacts () {
  if (!identity) return []
  try { return (await identity.listContacts()) || [] } catch (e) { console.warn('[here] listContacts', e); return [] }
}

// ── Delegación de capacidades (caps por dispositivo) ─────────────────────────

/**
 * Genera la sub-clave del DISPOSITIVO `D`. La privada nunca sale del dispositivo
 * lógico que la crea (aquí "here", que la entrega a OwnTracks vía la config). La
 * clave maestra del vault NUNCA la ve.
 * Devuelve { publickey, privateJwk, publicJwk, deviceId, label, createdAt }.
 */
export async function newDeviceKey (label = '') {
  return makeDeviceKey({ label })
}

/**
 * Pide al VAULT que firme un certificado de delegación a un dispositivo.
 *   sub   = device.publickey (JWK string)
 *   scope = ['geo:publish', 'geo:read:<circleId>']  (publicar + leer su círculo)
 * Devuelve { cert } o null si no hay vault.
 *
 * El bridge cerrado exige, además de la firma del vault, que pubkeyId(cert.iss)
 * === circleId.split(':')[0] (liga el cap al DUEÑO del círculo).
 */
export async function signCapForDevice ({ devicePublickey, scope, ttlMs, label } = {}) {
  if (!identity) return null
  try {
    return await identity.signDelegation(devicePublickey, scope, { ttlMs, label })
  } catch (e) {
    console.warn('[here] signDelegation falló', e)
    return null
  }
}

/** Revoca un cap por su nonce (mango de revocación). */
export async function revokeCap (nonce) {
  if (!identity) return null
  try { return await identity.revokeDelegation(nonce) } catch (e) { console.warn('[here] revokeDelegation', e); return null }
}

// URL del bridge cerrado de "here" (mismo origen que POST /here de geo.dotrino.com).
const HERE_BRIDGE_BASE = 'https://geo.dotrino.com'

/**
 * Postea al bridge un sobre FIRMADO por el dueño que revoca un cap por su nonce
 * dentro de un círculo. El bridge verifica firma + que pubkeyId(firmante) ===
 * owner del circleId y mete el nonce en su feed de revocación (un cert revocado
 * deja de poder publicar/leer end-to-end, no solo en el vault del dueño).
 *
 * El sobre es {data, signature} compatible con verifyEnvelope del server:
 *   data = { op:'revoke', circleId, nonce, issuedAt, publickey }
 *   signature = base64 ECDSA-P256 sobre el JSON canónico de data.
 *
 * @param {object} p
 * @param {string} p.circleId
 * @param {string} p.nonce
 * @param {string} [p.baseUrl]  default https://geo.dotrino.com
 * @returns {Promise<{ok:boolean, status:number, body?:any}>}
 */
export async function postRevokeToBridge ({ circleId, nonce, baseUrl = HERE_BRIDGE_BASE } = {}) {
  if (!identity) return { ok: false, status: 0, body: { error: 'sin vault' } }
  if (!circleId || !nonce) throw new Error('postRevokeToBridge: faltan circleId/nonce')
  // verifyEnvelope (server) lee data.publickey, así que DEBE ir embebido EN lo
  // firmado (no después). Resolvemos el pubkey maestro ANTES de firmar; si no lo
  // teníamos cacheado, una firma-sonda lo devuelve.
  let publickey = getMyPubkey()
  if (!publickey) { publickey = (await identity.signData({ probe: 1 })).publickey; myPubkey = publickey }
  const data = { op: 'revoke', circleId, nonce, issuedAt: Date.now(), publickey }
  const { signature } = await identity.signData(data)
  try {
    const res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/here/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, signature })
    })
    let body = null
    try { body = await res.json() } catch (_) {}
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    console.warn('[here] postRevokeToBridge falló', e)
    return { ok: false, status: 0, body: { error: e.message } }
  }
}

/**
 * Revoca un dispositivo de un círculo de forma END-TO-END:
 *   1) revoca el cap en el VAULT (revokeDelegation) — autoridad del dueño;
 *   2) ADEMÁS postea el nonce al bridge (/here/revoke) firmado, para que el
 *      corte sea inmediato en el canal en vivo (no solo en el vault del dueño).
 * `circleId` es necesario para que el bridge ligue la revocación a su dueño.
 *
 * @returns {Promise<{ vault:any, bridge:{ok:boolean, status:number, body?:any} }>}
 */
export async function revokeDevice ({ circleId, nonce, baseUrl } = {}) {
  if (!nonce) throw new Error('revokeDevice: falta nonce')
  const vault = await revokeCap(nonce)
  let bridge = { ok: false, status: 0, body: { error: 'sin circleId' } }
  if (circleId) bridge = await postRevokeToBridge({ circleId, nonce, baseUrl })
  return { vault, bridge }
}

/** Lista los caps emitidos por el vault (para mostrar/revocar). */
export async function listCaps () {
  if (!identity) return []
  try { return (await identity.listDelegations()) || [] } catch (e) { console.warn('[here] listDelegations', e); return [] }
}

/** id corto y estable de un pubkey (sha-256 hex). Reexport de la primitiva. */
export { pubkeyId }
