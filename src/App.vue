<script setup>
import { ref, computed, watchEffect, onMounted } from 'vue'
import { MESSAGES, detectLang } from '@/lib/i18n'
import { initIdentity, isIdentityReady } from '@/lib/identity'
import { getReputation } from '@/lib/reputation'
// Barra superior estándar del ecosistema (CONVENCIONES §5): marca + volver +
// idioma + perfil + moneda de support en UN componente. No re-armamos el header
// a mano; el topbar también instala el controlador de "volver" (@dotrino/nav) y
// es DUEÑO del modal de "Mi perfil" (§6.1).
import '@dotrino/topbar'
import iconUrl from '@/assets/icon.svg'

import CirclesView from '@/views/CirclesView.vue'
import DevicesView from '@/views/DevicesView.vue'
import ConfigView from '@/views/ConfigView.vue'

const lang = ref(detectLang())
const t = computed(() => MESSAGES[lang.value])
const tab = ref('circles')          // 'circles' | 'devices' | 'config'
const ready = ref(false)
const hasVault = ref(false)

const topbarRef = ref(null)
const identityInst = ref(null)
const reputationInst = ref(null)

// Tema del modal de perfil (el topbar lo abre con <dotrino-profile mode="self">),
// acorde al verde oscuro de "here". Sin esto la tarjeta saldría con el tema claro
// por defecto del paquete.
const profileTheme = {
  '--ccp-bg': '#0c1a16', '--ccp-bg-2': '#0f221c', '--ccp-bg-3': '#11271f', '--ccp-bg-4': '#163025',
  '--ccp-border': '#1e3a2e', '--ccp-text': '#e8f5ef', '--ccp-muted': '#8fb3a6',
  '--ccp-accent': '#0e7c63', '--ccp-accent-2': '#0a5f4c', '--ccp-accent-text': '#eafff8',
  '--ccp-gold': '#d4a72c', '--ccp-derived': '#8fb3a6',
  '--ccp-online': '#22d3aa', '--ccp-affinity': '#2dd4bf',
  '--ccp-input-bg': '#0f221c', '--ccp-radius': '14px',
  '--ccp-font': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--ccp-font-mono': 'ui-monospace, "SF Mono", Menlo, monospace'
}

// Los pilares se le pasan al topbar por PROPIEDAD JS (no atributo): con ellos
// arma el provider del perfil (createVaultProfileProvider) él mismo.
watchEffect(() => {
  const tb = topbarRef.value
  if (!tb) return
  tb.identity = identityInst.value ?? null
  tb.reputation = reputationInst.value ?? null
  tb.profileTheme = profileTheme
})

// El idioma lo manda el topbar (persiste en 'dotrino.lang', compartido con el
// resto del ecosistema); aquí solo seguimos su evento.
const onLang = (e) => { const l = e?.detail?.lang; if (l === 'es' || l === 'en') lang.value = l }

onMounted(async () => {
  const identity = await initIdentity()
  identityInst.value = identity
  hasVault.value = isIdentityReady()
  ready.value = true
  if (identity) { try { reputationInst.value = await getReputation() } catch (_) {} }
})
</script>

<template>
  <dotrino-topbar
    ref="topbarRef"
    :brand="t.appName"
    :icon="iconUrl"
    brand-href="./"
    :lang.attr="lang"
    profile
    support-href="https://ko-fi.com/dotrino"
    support-repo="imdotrino/dotrino-here"
    support-discord="https://discord.gg/D648uq7cth"
    @dotrino-lang="onLang"
  ></dotrino-topbar>

  <nav class="tabs">
    <button :class="{ on: tab === 'circles' }" data-testid="tab-circles" @click="tab = 'circles'">{{ t.tabCircles }}</button>
    <button :class="{ on: tab === 'devices' }" data-testid="tab-devices" @click="tab = 'devices'">{{ t.tabDevices }}</button>
    <button :class="{ on: tab === 'config' }" data-testid="tab-config" @click="tab = 'config'">{{ t.tabConfig }}</button>
  </nav>

  <main>
    <div v-if="ready && !hasVault" class="banner warn">{{ t.standalone }}</div>

    <CirclesView v-show="tab === 'circles'" :t="t" />
    <DevicesView v-show="tab === 'devices'" :t="t" />
    <ConfigView v-show="tab === 'config'" :t="t" />
  </main>
</template>
