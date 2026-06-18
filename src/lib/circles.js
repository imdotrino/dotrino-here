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
  if (!circleKey) throw new Error('encryptCircleKey: falta circleKey')
  if (!identity || typeof identity.encrypt !== 'function') {
    throw new Error('encryptCircleKey: falta identity (vault con encrypt)')
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
  if (!recipients.length) throw new Error('encryptCircleKey: ningún miembro con encryptionPubkey')
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

// ── Persistencia local de la metadata del círculo ────────────────────────────
//
// CONVENCIONES §4: el contenido del usuario que debe PERSISTIR va al store
// (store.dotrino.com, @dotrino/store). localStorage queda solo
// para preferencias efímeras de UI. Aquí dejamos un repositorio en memoria con
// el shape esperado; el cableado al store es un TODO (no rompe el esqueleto).
//
// TODO(store): reemplazar este repo en memoria por @dotrino/store
// (vault iframe + postMessage). Clave: 'here:circles'. La clave del círculo NO se
// guarda en claro: se guarda cifrada al propio vault (identity.encrypt a mí mismo)
// o se re-deriva; nunca en localStorage ni en un backend por app.

/**
 * Shape de un círculo en "here":
 * {
 *   id,            // circleId = pubkeyId(owner):slug
 *   slug, name,
 *   ownerPubkey,   // pubkey maestro del dueño (yo)
 *   key,           // clave simétrica del círculo (passphrase OwnTracks) — TODO: cifrar
 *   members: [ { pubkey, name, tid } ],          // miembros (de contactos del vault)
 *   devices: [ { deviceId, label, tid, capNonce, scope } ], // dispositivos pareados
 *   createdAt
 * }
 */
// STORE REACTIVO COMPARTIDO + persistencia local. UNA sola fuente de verdad reactiva
// para TODAS las vistas: crear/parear en una vista se refleja en las demás al instante
// (antes cada vista tenía su propio snapshot ref(listCircles()) y quedaba viejo).
// 'here:circles' guarda { circleId: circle }. CONVENCIONES §4: el durable/cross-device va
// al store (store.dotrino.com) — TODO(store) abajo; localStorage es el cache local.
const LS_KEY = 'here:circles'

function loadAll () {
  try { const o = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); return (o && typeof o === 'object') ? o : {} }
  catch (_) { return {} }
}

// Mapa reactivo { id: circle }. Las vistas leen `circlesList` (computed) → reactivo.
const _map = reactive(loadAll())
// Contador de versión: Object.values(_map) NO rastrea cambios PROFUNDOS (p.ej. mutar
// circle.devices de un círculo existente). Bumpeamos en cada cambio para forzar el
// re-cómputo de circlesList en TODAS las vistas (no solo en la que hizo el cambio).
const _ver = ref(0)
function bump () { _ver.value++ }
function persist () { try { localStorage.setItem(LS_KEY, JSON.stringify(_map)) } catch (_) {} }

/** Lista REACTIVA de círculos (usar en las vistas: `circlesList.value`). */
export const circlesList = computed(() => { _ver.value; return Object.values(_map) })

export function listCircles () { return Object.values(_map) }
export function getCircle (id) { return _map[id] || null }
export function saveCircle (circle) {
  if (!circle || !circle.id) return circle
  _map[circle.id] = circle      // asignación sobre reactive
  bump(); persist()             // bump → propaga a todas las vistas
  return circle
}
export function deleteCircle (id) { delete _map[id]; bump(); persist() }

// TODO(store): además del cache local, sincronizar al store del ecosistema
// (@dotrino/store, store.dotrino.com) para que los círculos viajen
// entre dispositivos del dueño. La clave del círculo NO se guarda en claro: se guarda
// cifrada al propio vault (identity.encrypt a mí mismo) antes de subirla.
