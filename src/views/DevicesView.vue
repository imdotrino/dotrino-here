<script setup>
// Pantalla DISPOSITIVOS — parear un dispositivo a un círculo:
//   1) makeDeviceKey()  → sub-clave del dispositivo (la maestra nunca la ve).
//   2) signDelegation(devicePublickey, ['geo:publish', 'geo:read:<circleId>'])
//      → el VAULT firma el cap. El bridge exige pubkeyId(cert.iss)===owner del
//        círculo + scope publish + scope read:<circleId>.
//
// ESQUELETO: no hay lógica de servidor. El cap firmado y la device key se
// guardan (TODO store) para que la pantalla "Generar config" arme el .otrc.
import { ref, computed, watch } from 'vue'
import {
  newDeviceKey, signCapForDevice, revokeDevice, pubkeyId, isIdentityReady
} from '@/lib/identity'
import { circlesList, getCircle, saveCircle } from '@/lib/circles'

const props = defineProps({ t: Object })

const circles = circlesList   // store reactivo compartido
const circleId = ref(circles.value[0]?.id || '')
const label = ref('')
const tid = ref('')
const busy = ref(false)

// Deriva del ref REACTIVO `circles` (no de getCircle, que no es reactivo): así al
// parear y refrescar, la lista de dispositivos se vuelve a renderizar.
const circle = computed(() => circles.value.find(c => c.id === circleId.value) || null)
const devices = computed(() => circle.value?.devices || [])
// Autoselecciona un círculo cuando aparece uno (creado en otra vista) y no hay selección.
watch(circles, (list) => { if (!circleId.value && list.length) circleId.value = list[0].id }, { immediate: true })

// TTL del cap por defecto: 30 días (tope duro de la primitiva).
const TTL_MS = 30 * 24 * 60 * 60 * 1000

function refresh () { /* store reactivo: no hace falta refrescar manualmente */ }

async function pair () {
  const c = getCircle(circleId.value)
  if (!c || busy.value) return
  busy.value = true
  try {
    // 1) clave del dispositivo (privada nunca sale del vault de identidad)
    const device = await newDeviceKey(label.value.trim())

    // 2) scope: publicar + leer ESTE círculo
    const scope = ['geo:publish', `geo:read:${c.id}`]

    // 3) el vault firma el cap (si hay identidad). En demo, sin firma.
    let cert = null
    if (isIdentityReady()) {
      const res = await signCapForDevice({
        devicePublickey: device.publickey,
        scope,
        ttlMs: TTL_MS,
        label: `here:${c.slug}:${label.value.trim() || device.deviceId.slice(0, 8)}`
      })
      cert = res?.cert || null
    }

    const entry = {
      deviceId: device.deviceId,
      label: label.value.trim() || device.deviceId.slice(0, 8),
      tid: tid.value.trim().slice(0, 2),
      // device.publicJwk va para verificación; la privateJwk se entrega a OwnTracks
      // vía la config (es la clave que firma sus publicaciones). TODO(store): guardar
      // privateJwk cifrada al vault, no en claro.
      devicePublickey: device.publickey,
      devicePrivateJwk: device.privateJwk,
      scope,
      cert,                         // null en modo demo
      capNonce: cert?.nonce || null,
      exp: cert?.exp || null,
      createdAt: Date.now()
    }
    c.devices = [...(c.devices || []), entry]
    saveCircle(c)                   // TODO(store): persistir
    label.value = ''
    tid.value = ''
    refresh()
  } finally {
    busy.value = false
  }
}

async function revoke (c, dev) {
  // Revocación END-TO-END: revoca el cap en el vault Y postea el nonce firmado al
  // bridge (/here/revoke), para que el corte sea inmediato en el canal en vivo y
  // no solo en el vault del dueño. circleId liga la revocación a su dueño.
  if (dev.capNonce) await revokeDevice({ circleId: c.id, nonce: dev.capNonce })
  c.devices = c.devices.filter(d => d.deviceId !== dev.deviceId)
  saveCircle(c)
  refresh()
}

function fmtDate (ms) {
  if (!ms) return '—'
  try { return new Date(ms).toLocaleDateString() } catch (_) { return '—' }
}
</script>

<template>
  <div class="stack">
    <div class="card">
      <h2>{{ t.devicesTitle }}</h2>
      <p class="muted">{{ t.devicesIntro }}</p>

      <div class="stack" style="margin-top:12px">
        <select v-model="circleId" data-testid="device-circle">
          <option value="" disabled>{{ t.selectCircle }}</option>
          <option v-for="c in circles" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <input v-model="label" :placeholder="t.deviceLabelPlaceholder" data-testid="device-label" />
        <input v-model="tid" :placeholder="t.tidPlaceholder" maxlength="2" data-testid="device-tid" />
        <p class="muted" data-testid="tid-hint" style="margin:-2px 0 0">{{ t.tidHint }}</p>
        <button class="primary" :disabled="!circleId || busy"
                data-testid="pair-device" @click="pair">
          {{ t.pair }}
        </button>
      </div>
    </div>

    <div v-if="circle" class="card">
      <h2>{{ circle.name }} — {{ t.devicesTitle }}</h2>
      <p v-if="devices.length === 0" class="muted">{{ t.devicesEmpty }}</p>
      <ul class="list">
        <li v-for="d in devices" :key="d.deviceId" class="list-item" :data-device-id="d.deviceId">
          <div>
            <div class="title">{{ d.label }} <span v-if="d.tid" class="pill">{{ d.tid }}</span></div>
            <div class="sub mono">{{ d.deviceId.slice(0, 20) }}…</div>
            <div class="sub">
              <span class="pill" :class="{ ok: d.cert }">
                {{ d.cert ? 'geo:publish + geo:read' : 'sin firma (demo)' }}
              </span>
              <span class="pill">{{ t.expires }}: {{ fmtDate(d.exp) }}</span>
            </div>
          </div>
          <div class="spacer"></div>
          <button class="ghost danger" :data-testid="`revoke-${d.deviceId.slice(0,8)}`"
                  @click="revoke(circle, d)">{{ t.revoke }}</button>
        </li>
      </ul>
    </div>
  </div>
</template>
