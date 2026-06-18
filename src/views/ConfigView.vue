<script setup>
// Pantalla GENERAR CONFIG — arma la config de OwnTracks para un dispositivo
// pareado y la muestra como QR (autohosteado, librería `qrcode`, sin servicios
// de terceros: la config lleva credenciales del usuario) + archivo .otrc.
//
// ESQUELETO: no llama al bridge ni al servidor; solo compone la config a partir
// del circleId, el cert firmado por el vault y la clave del círculo, y la pinta.
import { ref, computed, watch, nextTick } from 'vue'
import QRCode from 'qrcode'
import { circlesList } from '@/lib/circles'
import {
  buildOwnTracksConfig, toOtrcText, toOtrcQrPayload, configSummary
} from '@/lib/owntracks'

const props = defineProps({ t: Object })

const circles = circlesList   // store reactivo compartido
const circleId = ref(circles.value[0]?.id || '')
watch(circles, (list) => { if (!circleId.value && list.length) circleId.value = list[0].id }, { immediate: true })
const deviceId = ref('')
const canvas = ref(null)
const config = ref(null)
const copied = ref(false)

const circle = computed(() => circles.value.find(c => c.id === circleId.value) || null)
const devices = computed(() => circle.value?.devices || [])
const device = computed(() => devices.value.find(d => d.deviceId === deviceId.value) || null)
const summary = computed(() => config.value ? configSummary(config.value) : null)

// Campos copiables para configurar OwnTracks A MANO. El display enmascara el medio
// de los valores sensibles (cert/clave), pero el botón copia el valor COMPLETO.
const copiedField = ref('')
function maskMiddle (s) { return (!s || s.length <= 18) ? (s || '') : s.slice(0, 8) + '…' + s.slice(-6) }
const copyFields = computed(() => {
  const c = config.value
  if (!c) return []
  const f = [
    { key: 'url', label: props.t.serverUrl, value: c.url, display: c.url },
    { key: 'username', label: props.t.username, value: c.username, display: c.username },
    { key: 'password', label: props.t.passwordLabel, value: c.password, display: maskMiddle(c.password) }
  ]
  if (c.encryptionKey) f.push({ key: 'enckey', label: props.t.encKeyLabel, value: c.encryptionKey, display: maskMiddle(c.encryptionKey) })
  return f
})
// Deep-link tappable: en el MISMO teléfono abre OwnTracks e importa la config (incl. la
// encryption key). owntracks:///config?inline=<base64 estándar url-encoded>.
const otHref = computed(() => config.value ? toOtrcQrPayload(config.value) : '#')

async function copyField (key, value) {
  try {
    await navigator.clipboard.writeText(value)
    copiedField.value = key
    setTimeout(() => { if (copiedField.value === key) copiedField.value = '' }, 1500)
  } catch (_) {}
}

// Un dispositivo es "tuyo" (del dueño) cuando NO está atado a un miembro tercero
// (`forMember`). Solo en TU propia config se incrusta la clave del círculo en
// claro; a los terceros se les reparte CIFRADA (distributeCircleKey), nunca aquí.
const isOwnDevice = computed(() => !!device.value && !device.value.forMember)

watch(circleId, () => { deviceId.value = ''; config.value = null })

async function generate () {
  const c = circle.value
  const d = device.value
  if (!c || !d) return
  // El password es base64url(cert). Sin cert (demo) usamos un placeholder visible
  // para que el QR se vea; el bridge real rechazaría ese cert.
  const cert = d.cert || { v: 1, demo: true, note: 'sin-firma' }
  // La clave del círculo SOLO se incrusta en la config de TU propio dispositivo
  // (el dueño configura su teléfono). Para un dispositivo de un TERCERO no va en
  // claro: ese miembro la recibe cifrada por el reparto (distributeCircleKey) y
  // la mete él mismo en su OwnTracks. Aquí, sin clave, el QR cubre todo lo demás.
  const embeddedKey = isOwnDevice.value ? c.key : null
  config.value = buildOwnTracksConfig({
    circleId: c.id,
    cert,
    circleKey: embeddedKey,
    tid: d.tid || (d.label || '').slice(0, 2).toUpperCase(),
    deviceId: d.deviceId
  })
  await nextTick()
  await renderQr()
}

async function renderQr () {
  if (!canvas.value || !config.value) return
  const payload = toOtrcQrPayload(config.value)
  try {
    await QRCode.toCanvas(canvas.value, payload, { width: 256, margin: 1, errorCorrectionLevel: 'M' })
  } catch (e) { console.warn('[here] QR render', e) }
}

function downloadOtrc () {
  if (!config.value) return
  const blob = new Blob([toOtrcText(config.value)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `here-${circle.value?.slug || 'circle'}.otrc`
  a.click()
  URL.revokeObjectURL(url)
}

async function copyPayload () {
  if (!config.value) return
  try {
    await navigator.clipboard.writeText(toOtrcQrPayload(config.value))
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch (_) {}
}
</script>

<template>
  <div class="stack">
    <div class="card">
      <h2>{{ t.configTitle }}</h2>
      <p class="muted">{{ t.configIntro }}</p>

      <div class="stack" style="margin-top:12px">
        <select v-model="circleId" data-testid="config-circle">
          <option value="" disabled>{{ t.selectCircle }}</option>
          <option v-for="c in circles" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <select v-model="deviceId" :disabled="!circle" data-testid="config-device">
          <option value="" disabled>{{ t.selectDevice }}</option>
          <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">
            {{ d.label }}{{ d.tid ? ` (${d.tid})` : '' }}
          </option>
        </select>
        <button class="primary" :disabled="!device" data-testid="generate-config" @click="generate">
          {{ t.generate }}
        </button>
      </div>
    </div>

    <div v-if="!config" class="card">
      <p class="muted">{{ t.noConfigYet }}</p>
    </div>

    <div v-else class="card">
      <div class="qr-wrap">
        <canvas ref="canvas" data-testid="config-qr"></canvas>
      </div>

      <div class="stack" style="margin-top:14px">
        <!-- Valores para configurar OwnTracks a mano, cada uno con botón de copiar. -->
        <div class="list-item" v-for="f in copyFields" :key="f.key">
          <div style="min-width:0;flex:1">
            <div class="sub">{{ f.label }}</div>
            <div class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ f.display }}</div>
          </div>
          <div class="spacer"></div>
          <button class="ghost" :data-testid="`copy-${f.key}`" @click="copyField(f.key, f.value)">
            {{ copiedField === f.key ? t.copied : t.copy }}
          </button>
        </div>
        <div class="list-item">
          <div class="sub">{{ t.encrypted }}</div>
          <div class="spacer"></div>
          <span class="pill" :class="{ ok: summary.encrypted }">{{ summary.encrypted ? t.yes : t.no }}</span>
        </div>
        <!-- La clave del círculo NUNCA se muestra en claro para terceros: solo se
             incrusta en la propia config del dueño; al resto se reparte cifrada. -->
        <p class="muted" data-testid="key-policy">
          {{ isOwnDevice ? t.keyEmbedded : t.keyOwnerOnly }}
        </p>
      </div>

      <!-- En el MISMO teléfono: abrir OwnTracks directo (no se puede escanear el QR a uno mismo). -->
      <a class="primary" :href="otHref" data-testid="open-owntracks"
         style="display:block;text-align:center;text-decoration:none;margin-top:14px">
        {{ t.openOwnTracks }}
      </a>
      <p class="muted" style="margin:6px 0 0">{{ t.openOwnTracksHint }}</p>

      <div class="row wrap" style="margin-top:12px">
        <button class="ghost" data-testid="download-otrc" @click="downloadOtrc">{{ t.downloadOtrc }}</button>
        <button class="ghost" data-testid="copy-payload" @click="copyPayload">
          {{ copied ? t.copied : t.copyPayload }}
        </button>
      </div>
      <!-- TODO(bridge): aquí NO se llama al servidor. OwnTracks, ya configurado,
           publica solo contra https://geo.dotrino.com/here en background. -->
    </div>

    <!-- Guía: cómo configurar OwnTracks (siempre visible) -->
    <div class="card" data-testid="owntracks-guide">
      <h2>{{ t.setupTitle }}</h2>
      <p class="muted">{{ t.setupIntro }}</p>
      <div class="stack" style="margin-top:10px">
        <div class="list-item">
          <div>
            <div class="sub">{{ t.setupGet }}</div>
            <div class="muted">{{ t.setupGetHint }}</div>
          </div>
        </div>
        <div class="list-item">
          <div><div class="sub">{{ t.setupScan }}</div></div>
        </div>
      </div>

      <details open style="margin-top:12px">
        <summary class="muted" style="cursor:pointer">{{ t.setupManualLead }}</summary>
        <div class="stack" style="margin-top:8px">
          <div class="list-item"><div class="sub">{{ t.setupRowMode }}</div><div class="spacer"></div><span class="mono">{{ t.setupRowModeV }}</span></div>
          <div class="list-item"><div class="sub">{{ t.setupRowUrl }}</div><div class="spacer"></div><span class="muted">{{ t.setupRowUrlV }}</span></div>
          <div class="list-item"><div class="sub">{{ t.setupRowUser }}</div><div class="spacer"></div><span class="muted">{{ t.setupRowUserV }}</span></div>
          <div class="list-item"><div class="sub">{{ t.setupRowPass }}</div><div class="spacer"></div><span class="muted">{{ t.setupRowPassV }}</span></div>
          <div class="list-item"><div class="sub">{{ t.setupRowKey }}</div><div class="spacer"></div><span class="muted">{{ t.setupRowKeyV }}</span></div>
        </div>
      </details>

      <p class="muted" data-testid="setup-closed" style="margin-top:12px">{{ t.setupClosed }}</p>
    </div>
  </div>
</template>
