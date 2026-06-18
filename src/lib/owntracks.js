// Generación de la config de OwnTracks que "here" entrega al usuario.
//
// OwnTracks corre solo, EN BACKGROUND, CERRADO y cifrado; "here" no necesita
// estar abierto. Solo arma la config y la entrega como QR / archivo .otrc
// importable para no tipear nada.
//
// Contrato del bridge cerrado (dotrino-geo, ruta nueva POST /here):
//   · Auth: HTTP Basic
//       username = circleId
//       password = base64url(JSON.stringify(cert))   ← cap del dispositivo
//   · URL = https://geo.dotrino.com/here  (modo HTTP de OwnTracks)
//   · Encryption key = la clave del círculo (secretbox) → OwnTracks cifra el
//     payload localmente y descifra a los amigos para pintarlos en el mapa.
//   · El bridge guarda el ÚLTIMO blob por miembro (TTL + overwrite, efímero) y
//     responde con los blobs recientes de los OTROS miembros del MISMO círculo.

const GEO_HERE_URL = 'https://geo.dotrino.com/here'

/** base64url(JSON) sin padding — formato del PASSWORD (cert) que el bridge parsea. */
export function base64url (obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj)
  // UTF-8 seguro
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64 ESTÁNDAR (con +/=). OwnTracks decodifica el `inline` con Base64.DEFAULT
 *  (estándar), NO url-safe → el QR/link de import DEBE ir en base64 estándar. */
export function base64std (obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj)
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * Arma el objeto de configuración de OwnTracks (HTTP mode) para un dispositivo
 * concreto dentro de un círculo.
 *
 * @param {object} p
 * @param {string} p.circleId   - pubkeyId(owner):slug
 * @param {object} p.cert       - certificado de delegación firmado por el vault
 * @param {string} p.circleKey  - passphrase de cifrado del círculo (Encryption key)
 * @param {string} p.tid        - Tracker ID (2 chars) del dispositivo
 * @param {string} [p.deviceId] - id del dispositivo (para deviceId de OwnTracks)
 * @returns {object} config OwnTracks (.otrc)
 */
export function buildOwnTracksConfig ({ circleId, cert, circleKey, tid, deviceId } = {}) {
  const password = base64url(cert)
  return {
    _type: 'configuration',
    // Conexión en modo HTTP contra el bridge de geo.
    mode: 3,                     // 3 = HTTP en OwnTracks
    url: GEO_HERE_URL,
    auth: true,
    username: circleId,          // ← circleId
    password,                    // ← base64url(cert): el bridge lo parsea y verifica
    // Identidad del dispositivo dentro del círculo.
    deviceId: deviceId || tid || 'here',
    tid: (tid || '').slice(0, 2),
    // Cifrado de extremo a extremo entre miembros (el bridge NO descifra).
    encryptionKey: circleKey,    // ← clave del círculo (secretbox)
    // Buenos defaults para "ubicación familiar" en background.
    locatorPriority: 2,
    locatorDisplacement: 50,
    locatorInterval: 60,
    cleanSession: false,
    pubExtendedData: true
  }
}

/**
 * Serializa la config como texto de archivo .otrc (JSON). OwnTracks importa
 * tanto .otrc (archivo) como un QR que contenga este mismo JSON / una URL
 * `owntracks:///config?inline=<base64>`.
 */
export function toOtrcText (config) {
  return JSON.stringify(config, null, 2)
}

/**
 * Carga (URL) que va dentro del QR. OwnTracks reconoce el esquema
 * `owntracks:///config?inline=<base64(config)>` para importar config por QR/enlace.
 * El QR lo pinta la pantalla "Generar config" con el componente compartido /
 * la librería `qrcode` (autohosteado, sin servicios de terceros: la config
 * lleva credenciales del usuario y no puede salir a un generador externo).
 */
export function toOtrcQrPayload (config) {
  // OwnTracks importa con owntracks:///config?inline=<base64 ESTÁNDAR CRUDO> (lo que
  // documenta y lo que produce su propio export). Decodifica con Base64.DEFAULT (estándar,
  // NO url-safe) → por eso NO usamos base64url ni url-encode aquí. Sirve para el QR
  // (cross-device) y para el deep-link tappable (mismo teléfono). El password (cert) que
  // va DENTRO del JSON sigue en base64url (lo exige el bridge); son cosas distintas.
  return `owntracks:///config?inline=${base64std(config)}`
}

/** Resumen legible (para mostrar bajo el QR sin exponer el cert/clave en claro). */
export function configSummary (config) {
  return {
    url: config.url,
    username: config.username,
    tid: config.tid,
    encrypted: !!config.encryptionKey
  }
}
