import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// La moneda de support (<dotrino-support>) y la navegación "volver"
// (@dotrino/nav: chevron + botón físico de Android / gesto de iOS / atrás del
// navegador → cierra modal; si no hay nada → dotrino.com) las trae e instala
// <dotrino-topbar> (ver App.vue). No las cableamos aquí: sería duplicarlas.

// Registro del service worker (PWA) tras el load. CONVENCIONES §3.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

createApp(App).mount('#app')
