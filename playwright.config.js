import { defineConfig, devices } from '@playwright/test'

// E2E REAL para la app "here" (Vite + Vue 3, configurador de OwnTracks).
//
// Levanta el dev server real ('npm run dev' → Vite en el puerto del vite.config,
// 3120) y corre los flujos CORE contra él en un Chromium de verdad. NO mockea el
// vault: en e2e sin sesión, id.dotrino.com cae a modo DEMO (getMyPubkey null →
// circleId 'demo:<slug>'); los tests toleran ese modo (ver here.spec.js).

const PORT = 3120
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // Un fallo es un fallo: nada de reintentos que escondan flujos rotos.
  retries: 0,
  // Los tests comparten localStorage del MISMO origen, así que NO corren en
  // paralelo entre sí dentro del archivo (workers=1) para que un test no le
  // pise los círculos a otro. Cada test limpia su propio estado igualmente.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // El vault vive en otro origen (iframe). Sin red/sesión, su carga falla y la
    // app entra en modo demo; le damos margen de navegación de todos modos.
    navigationTimeout: 15_000,
    actionTimeout: 10_000
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  // Levanta el dev server REAL. reuseExistingServer en local para no chocar si ya
  // está corriendo; en CI siempre arranca uno limpio.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
