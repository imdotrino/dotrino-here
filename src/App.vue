<script setup>
import { ref, computed, onMounted } from 'vue'
import { MESSAGES, detectLang, saveLang } from '@/lib/i18n'
import { initIdentity, getIdentity, getMyPubkey, getMyName, isIdentityReady } from '@/lib/identity'
import iconUrl from '@/assets/icon.svg'

import CirclesView from '@/views/CirclesView.vue'
import DevicesView from '@/views/DevicesView.vue'
import ConfigView from '@/views/ConfigView.vue'

const lang = ref(detectLang())
const t = computed(() => MESSAGES[lang.value])
const tab = ref('circles')          // 'circles' | 'devices' | 'config'
const ready = ref(false)
const hasVault = ref(false)

// <dotrino-profile> (mi propio perfil). El provider se cablea con el vault;
// aquí dejamos el modal montado bajo demanda. Reusa el Web Component compartido
// (CONVENCIONES §6.1) — prohibido reimplementar la tarjeta a mano.
const profileEl = ref(null)
const profileOpen = ref(false)

function setLang (l) { lang.value = l; saveLang(l) }

onMounted(async () => {
  await initIdentity()
  hasVault.value = isIdentityReady()
  ready.value = true
  // Cargar el Web Component de perfil bajo demanda (no en el bundle crítico).
  // TODO(profile): import('@dotrino/profile') +
  //   createVaultProfileProvider({ identity, reputation }) y abrir mode="self".
})

function openMyProfile () {
  profileOpen.value = true
  // TODO(profile): renderizar <dotrino-profile modal mode="self"
  //   :pubkey="getMyPubkey()" :name="getMyName()" :lang="lang" :provider="..."/>
  //   con el provider del vault. De momento es un placeholder.
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <img :src="iconUrl" alt="" />
      <span>{{ t.appName }}</span>
    </div>
    <div class="topbar-actions">
      <div class="lang-selector" role="group" aria-label="es / en">
        <button :class="{ on: lang === 'es' }" @click="setLang('es')">ES</button>
        <button :class="{ on: lang === 'en' }" @click="setLang('en')">EN</button>
      </div>
      <!-- Botón de perfil: inmediatamente a la izquierda de la moneda (§6.1). -->
      <button class="profile-btn" data-testid="my-profile"
              @click="openMyProfile" :title="t.myProfile" :aria-label="t.myProfile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
        </svg>
      </button>
      <dotrino-support class="topbar-coin"
        href="https://ko-fi.com/dotrino"
        repo="imdotrino/dotrino-here"
        discord="https://discord.gg/D648uq7cth"
        :lang="lang"></dotrino-support>
    </div>
  </header>

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
