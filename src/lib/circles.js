// Modelo de CÍRCULO de "here" (esqueleto, sin lógica de servidor).
//
// Un círculo es un grupo privado de ubicación. Su identidad criptográfica liga
// el círculo a su DUEÑO (contrato del bridge cerrado en dotrino-geo):
//
//   circleId = pubkeyId(ownerMasterPubkey) + ':' + slug
//
// El bridge exige que cert.iss (la maestra que firmó el cap) tenga
// pubkeyId === circleId.split(':')[0]. Así nadie puede reclamar un circleId que
// no sea suyo.
//
// La "clave del círculo" es una clave simétrica (libsodium secretbox) que SOLO
// conocen los miembros: OwnTracks cifra/descifra la ubicación localmente con
// ella (Encryption key de OwnTracks). El bridge ve únicamente ciphertext opaco.
// "here" la genera, la reparte cifrada a cada miembro y la mete en la config.

import { reactive, computed, ref } from 'vue'
import { pubkeyId } from '@dotrino/identity/capabilities'
import { Store } from '@dotrino/store'
import { initIdentity } from './identity.js'

/** slug seguro para usar dentro del circleId (ASCII, sin ':' ni espacios). */
export function slugify (name) {
  return String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'circulo'
}

/**
 * Deriva el circleId a partir del pubkey maestro del dueño y un slug.
 *   circleId = pubkeyId(ownerMasterPubkey) + ':' + slug
 */
export async function deriveCircleId (ownerMasterPubkey, slug) {
  const ownerId = await pubkeyId(ownerMasterPubkey)
  return `${ownerId}:${slug}`
}

// ── Clave simétrica del círculo (OwnTracks Encryption key) ───────────────────

/**
 * Genera la clave del círculo (32 bytes para libsodium secretbox), en base64.
 *
 * NOTA: OwnTracks deriva su clave de cifrado de un PASSPHRASE (campo "Encryption
 * key"), no de bytes crudos. Aquí generamos una passphrase de alta entropía que
 * va idéntica en la config de cada miembro. Es la MISMA cadena para todo el
 * círculo (clave compartida del grupo).
 */
export function generateCircleKey () {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // base64url sin padding: imprimible y estable para el campo de OwnTracks.
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Token estable con el que se direcciona el `wrap` de un miembro dentro del
 * sobre de `identity.encrypt`. NO es secreto: es solo la etiqueta que el emisor
 * y el receptor calculan por igual a partir del pubkey del receptor (pubkeyId,
 * sha-256 hex del JWK canónico). El receptor lo recomputa de su propio pubkey
 * para encontrar su entrada y descifrar.
 */
export async function memberWrapToken (memberPubkey) {
  return pubkeyId(memberPubkey)
}

/**
 * CIFRA la clave del círculo para cada miembro usando el vault del ecosistema
 * (ECDH per-recipient + AES-GCM; NO reimplementamos cripto). Devuelve un sobre
 * con un `wrap` por miembro: solo el dueño de cada clave de cifrado puede abrir
 * el suyo. La clave del círculo NUNCA viaja en claro al transporte ni al bridge.
 *
 * @param {object} p
 * @param {string} p.circleKey  clave simétrica del círculo (passphrase OwnTracks)
 * @param {Array<{publickey:string, encryptionPubkey:string, nickname?:string}>} p.members
 *        miembros (de los contactos del vault). Necesitan `encryptionPubkey`.
 * @param {object} p.identity    handle del vault (identity.encrypt)
 * @returns {Promise<{ envelope: object, tokens: Record<string,string>, skipped: string[] }>}
 *   envelope = sobre de identity.encrypt; tokens = pubkey→wrapToken (para que cada
 *   miembro sepa qué entrada del wrap es la suya); skipped = miembros sin encPubkey.
 */
export async function encryptCircleKey ({ circleKey, members, identity } = {}) {
  if (!circleKey) throw new Error('encryptCircleKey: missing circleKey')
  if (!identity || typeof identity.encrypt !== 'function') {
    throw new Error('encryptCircleKey: missing identity (vault with encrypt)')
  }
  const list = Array.isArray(members) ? members : []
  const recipients = []
  const tokens = {}
  const skipped = []
  for (const m of list) {
    if (!m || !m.publickey || !m.encryptionPubkey) { if (m?.publickey) skipped.push(m.publickey); continue }
    // token = pubkeyId(member.publickey): estable, recomputable por el receptor.
    const token = await memberWrapToken(m.publickey)
    recipients.push({ token, encryptionPubkey: m.encryptionPubkey })
    tokens[m.publickey] = token
  }
  if (!recipients.length) throw new Error('encryptCircleKey: no member has an encryptionPubkey')
  // ÚNICO punto de cifrado: el vault. Un wrap por destinatario; el `ct` (clave del
  // círculo) es el mismo para todos, cada wrap lo abre solo su dueño.
  const envelope = await identity.encrypt(recipients, circleKey)
  return { envelope, tokens, skipped }
}

/**
 * Reparte la clave del círculo a cada miembro: la CIFRA (encryptCircleKey) y
 * entrega cada sobre al miembro. El cifrado es REAL aquí; el ENVÍO por el
 * transporte queda como punto de extensión (proxy / deep-link).
 *
 * @param {object} p
 * @param {string} p.circleKey
 * @param {Array} p.members
 * @param {object} p.identity
 * @param {(args:{member:object, envelope:object, token:string})=>Promise<void>} [p.deliver]
 *        callback de ENTREGA por miembro. Si no se pasa, no envía nada (solo cifra)
 *        y deja la entrega para que la cablee el caller.
 * @returns {Promise<{ envelope: object, tokens: Record<string,string>, delivered: string[], skipped: string[] }>}
 */
export async function distributeCircleKey ({ circleKey, members, identity, deliver } = {}) {
  const { envelope, tokens, skipped } = await encryptCircleKey({ circleKey, members, identity })
  const delivered = []
  if (typeof deliver === 'function') {
    for (const m of (members || [])) {
      const token = tokens[m?.publickey]
      if (!token) continue
      // El sobre completo se entrega tal cual: ya está cifrado por destinatario.
      // El miembro recomputa su token (pubkeyId de su propio pubkey) y descifra
      // SU wrap con su vault (identity.decrypt). Nada va en claro al transporte.
      await deliver({ member: m, envelope, token })
      delivered.push(m.publickey)
    }
  }
  // TODO(transporte): cuando @dotrino/proxy-client esté cableado
  // en "here", pasar `deliver` que haga sendByPubkey(member.publickey, {kind:'here:circle-key',
  // circleId, envelope, token}) — cola offline 24 h — o incrustar el sobre en el
  // deep-link de invitación (#fragment, nunca al server). El CIFRADO ya es real.
  return { envelope, tokens, delivered, skipped }
}

// ── Persistencia de los círculos: EN EL ALMACÉN DEL PERFIL (§4) ────────────────
//
// Hasta 2026-09-30 vivían solo en localStorage ('here:circles'), con la clave de cada
// círculo EN CLARO: sin respaldo en la bóveda y fuera del perfil. Ahora:
//  · cada círculo es una entrada del hilo `here.circles` de @dotrino/store, atado al
//    perfil (y respaldado en la bóveda si hay una);
//  · la clave del círculo va SELLADA con la llave de la cuenta (`sealContent`): la abren
//    todos los aparatos del acta, y la bóveda la vuelve a cerrar si la llave rota;
//  · la primera vez se traen los de localStorage (sin borrarlos);
//  · si el almacén no abre, se DICE (`circlesStoreError`), no se sigue en silencio.


const THREAD = 'here.circles'
const LS_LEGACY = 'here:circles'
const LS_IMPORTED = 'here:circles:imported'

// Mapa reactivo { id: circle } (con la clave ya abierta, solo en memoria).
const _map = reactive({})
const _ver = ref(0)
function bump () { _ver.value++ }

/** Error del almacén, para enseñarlo en pantalla (null si todo bien). */
export const circlesStoreError = ref(null)
/** true cuando ya se cargó lo del almacén. */
export const circlesLoaded = ref(false)

let storePromise = null
function openStore () {
  if (!storePromise) {
    storePromise = (async () => {
      const identity = await initIdentity()
      if (!identity) throw Object.assign(new Error('identity not available'), { code: 'no-identity' })
      return { identity, store: await Store.connect({ identity }) }
    })().catch((e) => { storePromise = null; throw e })
  }
  return storePromise
}

const plain = (v) => JSON.parse(JSON.stringify(v))

async function toEntry (identity, circle) {
  const { key, ...rest } = plain(circle)
  return { id: circle.id, ts: Date.now(), circle: { ...rest, key: key ? await identity.sealContent(String(key)) : null } }
}

async function fromEntry (identity, e) {
  const c = e.circle
  return { ...c, key: c.key ? await identity.openContent(c.key) : null }
}

/** Trae al almacén, una vez, los círculos que había en localStorage (no los borra). */
async function importLegacy (identity, store) {
  let raw = null
  try { if (localStorage.getItem(LS_IMPORTED)) return; raw = localStorage.getItem(LS_LEGACY) } catch (_) { return }
  let legacy = {}
  try { legacy = JSON.parse(raw || '{}') || {} } catch (_) { legacy = {} }
  const ya = new Set((await store.listThread(THREAD)).map((e) => e.id))
  for (const c of Object.values(legacy)) {
    if (c && c.id && !ya.has(c.id)) await store.appendMessage(THREAD, await toEntry(identity, c))
  }
  localStorage.setItem(LS_IMPORTED, String(Date.now()))
}

/** Carga los círculos del almacén. Lo llama App al arrancar; las vistas leen `circlesList`. */
export async function loadCircles () {
  try {
    const { identity, store } = await openStore()
    await importLegacy(identity, store)
    const entries = await store.listThread(THREAD)
    for (const k of Object.keys(_map)) delete _map[k]
    for (const e of entries) if (e && e.circle) _map[e.id] = await fromEntry(identity, e)
    circlesStoreError.value = null
  } catch (e) {
    console.error('[here] circles store unavailable:', e)
    circlesStoreError.value = e?.code || 'store-unavailable'
  } finally {
    circlesLoaded.value = true
    bump()
  }
}

/** Lista REACTIVA de círculos (usar en las vistas: `circlesList.value`). */
export const circlesList = computed(() => { _ver.value; return Object.values(_map) })

export function listCircles () { return Object.values(_map) }
export function getCircle (id) { return _map[id] || null }

/** Guarda el círculo (en pantalla al instante; en el almacén por detrás, y si falla se dice). */
export function saveCircle (circle) {
  if (!circle || !circle.id) return circle
  _map[circle.id] = circle
  bump()
  openStore()
    .then(async ({ identity, store }) => store.appendMessage(THREAD, await toEntry(identity, circle)))
    .then(() => { circlesStoreError.value = null })
    .catch((e) => { console.error('[here] could not save circle:', e); circlesStoreError.value = e?.code || 'store-unavailable' })
  return circle
}

export function deleteCircle (id) {
  delete _map[id]
  bump()
  openStore()
    .then(({ store }) => store.removeMessage(THREAD, id))
    .catch((e) => { console.error('[here] could not delete circle:', e); circlesStoreError.value = e?.code || 'store-unavailable' })
}
