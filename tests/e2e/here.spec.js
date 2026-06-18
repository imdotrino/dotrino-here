import { test, expect } from '@playwright/test'

// ── E2E REAL de "here" (configurador de OwnTracks) ───────────────────────────
//
// Corre contra el dev server de Vite (ver playwright.config.js) en un Chromium
// de verdad. NO mockea nada: el vault id.dotrino.com se carga en un iframe y,
// sin sesión, la app cae a modo DEMO (getMyPubkey null → circleId 'demo:<slug>').
// Los tests TOLERAN el modo demo: no asumen vault, no asumen el prefijo del id,
// y aceptan tanto la firma real como "sin firma (demo)".
//
// Estos tests EJERCITAN los flujos CORE de verdad (crear círculo + persistencia,
// parear dispositivo + persistencia, generar config con QR/summary, guía de
// OwnTracks, arranque en demo). Si esos flujos se rompen, los tests FALLAN — no
// son triviales.
//
// IMPORTANTE sobre reactividad entre vistas: las tabs usan v-show (todas las
// vistas quedan montadas), pero DevicesView/ConfigView leen un snapshot
// `ref(listCircles())` en su mount. Por eso, tras crear un círculo en la pestaña
// Círculos, RECARGAMOS antes de operar en Dispositivos/Config: el reload remonta
// las vistas y los selects ven el círculo recién creado desde localStorage. Esto
// además prueba la persistencia, que es justo lo que el usuario reportó roto.

const LS_KEY = 'here:circles'

/** Limpia el estado local de "here" para arrancar de cero en cada test. */
async function resetApp (page) {
  await page.goto('/')
  await page.evaluate((key) => {
    localStorage.removeItem(key)
    // Forzamos español para que las aserciones por texto sean estables.
    localStorage.setItem('here:lang', 'es')
  }, LS_KEY)
  await page.reload()
  // La app está lista cuando la barra de tabs está montada.
  await expect(page.getByTestId('tab-circles')).toBeVisible()
}

/**
 * Crea un círculo desde la pestaña Círculos y espera a que su tarjeta aparezca.
 * Devuelve el circleId real (sea 'demo:<slug>' o pubkeyId:<slug>).
 */
async function createCircle (page, name) {
  await page.getByTestId('tab-circles').click()
  const input = page.getByTestId('circle-name')
  await expect(input).toBeVisible()
  await input.fill(name)
  await page.getByTestId('create-circle').click()

  // La tarjeta del círculo aparece con [data-circle-id]; tomamos la que muestra
  // el nombre creado (hay una sola en estos tests).
  const card = page.locator('[data-circle-id]').filter({ hasText: name })
  await expect(card).toBeVisible()
  const id = await card.getAttribute('data-circle-id')
  expect(id, 'el círculo debe tener un circleId').toBeTruthy()
  return id
}

test.describe('here — flujos core', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  // (6) Modo demo (sin vault) no rompe: la app arranca, muestra las tabs y la
  //     vista de Círculos sin lanzar excepciones. Si hubiera un error fatal en el
  //     arranque (p. ej. el vault no manejado), la UI no se montaría.
  test('arranca en modo demo sin romper (sin vault)', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    // Las tres tabs presentes.
    await expect(page.getByTestId('tab-circles')).toBeVisible()
    await expect(page.getByTestId('tab-devices')).toBeVisible()
    await expect(page.getByTestId('tab-config')).toBeVisible()

    // La pantalla de Círculos es la activa por defecto: su input está visible.
    await expect(page.getByTestId('circle-name')).toBeVisible()
    await expect(page.getByTestId('create-circle')).toBeVisible()

    // Sin errores fatales de página (el fallo del vault se traga en modo demo).
    expect(errors, `errores de página: ${errors.join(' | ')}`).toEqual([])
  })

  // (1) Navegación entre tabs: al cambiar de tab se ve el contenido propio de
  //     cada vista y se ocultan los de las otras (v-show alterna visibilidad).
  test('navega entre tabs y muestra el contenido de cada vista', async ({ page }) => {
    // Círculos (activa por defecto)
    await expect(page.getByTestId('circle-name')).toBeVisible()
    // El select de dispositivos pertenece a otra vista y está OCULTO ahora.
    await expect(page.getByTestId('device-circle')).toBeHidden()

    // → Dispositivos
    await page.getByTestId('tab-devices').click()
    await expect(page.getByTestId('device-circle')).toBeVisible()
    await expect(page.getByTestId('device-label')).toBeVisible()
    await expect(page.getByTestId('device-tid')).toBeVisible()
    await expect(page.getByTestId('pair-device')).toBeVisible()
    await expect(page.getByTestId('tid-hint')).toBeVisible()
    await expect(page.getByTestId('circle-name')).toBeHidden()

    // → Generar config
    await page.getByTestId('tab-config').click()
    await expect(page.getByTestId('config-circle')).toBeVisible()
    await expect(page.getByTestId('config-device')).toBeVisible()
    await expect(page.getByTestId('generate-config')).toBeVisible()
    // La guía de OwnTracks vive en esta vista (siempre visible dentro de ella).
    await expect(page.getByTestId('owntracks-guide')).toBeVisible()
    await expect(page.getByTestId('device-circle')).toBeHidden()

    // ← de vuelta a Círculos
    await page.getByTestId('tab-circles').click()
    await expect(page.getByTestId('circle-name')).toBeVisible()
    await expect(page.getByTestId('config-circle')).toBeHidden()
  })

  // (2) Crear círculo → aparece → RECARGAR → SIGUE (persistencia).
  //     Este es el flujo que el usuario reportó roto ("crear círculo no persistía").
  test('crea un círculo, persiste y sobrevive a un reload', async ({ page }) => {
    const name = 'Familia E2E'
    const id = await createCircle(page, name)

    // Aparece en la lista con su clave del círculo (la genera generateCircleKey).
    const card = page.locator(`[data-circle-id="${id}"]`)
    await expect(card).toContainText(name)
    // Hay una clave del círculo no vacía (data-testid key-<slug>).
    const slug = id.includes(':') ? id.split(':').pop() : id
    const keyEl = page.getByTestId(`key-${slug}`)
    await expect(keyEl).toBeVisible()
    await expect(keyEl).not.toBeEmpty()

    // Persiste en localStorage 'here:circles'.
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), LS_KEY)
    expect(Object.keys(stored)).toContain(id)
    expect(stored[id].name).toBe(name)

    // RECARGA: el círculo SIGUE (no se evapora).
    await page.reload()
    await page.getByTestId('tab-circles').click()
    await expect(page.locator(`[data-circle-id="${id}"]`)).toBeVisible()
    await expect(page.locator(`[data-circle-id="${id}"]`)).toContainText(name)
  })

  // (3) Parear dispositivo → aparece en la lista → recargar → sigue.
  //     El otro flujo reportado roto ("parear dispositivo no hacía nada").
  test('parea un dispositivo, aparece en la lista y persiste tras reload', async ({ page }) => {
    const circleName = 'Casa E2E'
    const id = await createCircle(page, circleName)

    // Recargamos para que la vista Dispositivos remonte y su select vea el círculo
    // recién creado (también valida que el círculo persiste).
    await page.reload()
    await page.getByTestId('tab-devices').click()

    // Selecciona el círculo en el select de dispositivos (por value = circleId).
    const circleSel = page.getByTestId('device-circle')
    await expect(circleSel).toBeVisible()
    await circleSel.selectOption(id)

    // Rellena nombre y TID y parea.
    await page.getByTestId('device-label').fill('Telefono de Ana')
    await page.getByTestId('device-tid').fill('AN')
    const pairBtn = page.getByTestId('pair-device')
    await expect(pairBtn).toBeEnabled()
    await pairBtn.click()

    // Aparece un dispositivo en la lista [data-device-id]. makeDeviceKey + (en
    // demo) sin firma; aceptamos ambas insignias.
    const deviceRow = page.locator('[data-device-id]')
    await expect(deviceRow).toHaveCount(1)
    await expect(deviceRow.first()).toContainText('Telefono de Ana')
    await expect(deviceRow.first()).toContainText('AN')

    // Persistió en localStorage: el círculo ahora tiene 1 device.
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), LS_KEY)
    expect(stored[id], 'el círculo debe seguir en el store').toBeTruthy()
    expect(stored[id].devices.length).toBe(1)
    expect(stored[id].devices[0].label).toBe('Telefono de Ana')
    expect(stored[id].devices[0].tid).toBe('AN')

    // RECARGA: el dispositivo SIGUE.
    await page.reload()
    await page.getByTestId('tab-devices').click()
    await page.getByTestId('device-circle').selectOption(id)
    const deviceRow2 = page.locator('[data-device-id]')
    await expect(deviceRow2).toHaveCount(1)
    await expect(deviceRow2.first()).toContainText('Telefono de Ana')
  })

  // (4) Generar config → el QR (canvas) se renderiza + el summary.
  //     Encadena crear círculo → parear dispositivo → generar config.
  test('genera la config: pinta el QR (canvas) y muestra el summary', async ({ page }) => {
    const circleName = 'Viaje E2E'
    const id = await createCircle(page, circleName)

    // Parea un dispositivo (necesario para poder generar config).
    await page.reload()
    await page.getByTestId('tab-devices').click()
    await page.getByTestId('device-circle').selectOption(id)
    await page.getByTestId('device-label').fill('Tablet')
    await page.getByTestId('device-tid').fill('TB')
    await page.getByTestId('pair-device').click()
    await expect(page.locator('[data-device-id]')).toHaveCount(1)

    // Recargamos para que ConfigView remonte y su select vea el círculo + device.
    await page.reload()
    await page.getByTestId('tab-config').click()

    // Selecciona círculo y dispositivo, genera.
    await page.getByTestId('config-circle').selectOption(id)
    const devSel = page.getByTestId('config-device')
    await expect(devSel).toBeEnabled()
    // El device se identifica por su deviceId (value de la opción); tomamos el
    // único value no vacío disponible.
    const devValue = await devSel.locator('option:not([value=""])').first().getAttribute('value')
    expect(devValue, 'debe haber un dispositivo pareado seleccionable').toBeTruthy()
    await devSel.selectOption(devValue)

    const genBtn = page.getByTestId('generate-config')
    await expect(genBtn).toBeEnabled()
    await genBtn.click()

    // El canvas del QR se renderiza con contenido (no en blanco): buildOwnTracksConfig
    // + QRCode.toCanvas. Validamos que el canvas existe, es visible y tiene píxeles.
    const qr = page.getByTestId('config-qr')
    await expect(qr).toBeVisible()
    const drawn = await qr.evaluate((c) => {
      const cv = /** @type {HTMLCanvasElement} */ (c)
      if (!cv.width || !cv.height) return false
      const ctx = cv.getContext('2d')
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height)
      // Hay al menos un píxel no transparente/no blanco → el QR se pintó.
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
        if (a !== 0 && !(r === 255 && g === 255 && b === 255)) return true
      }
      return false
    })
    expect(drawn, 'el QR debe pintarse en el canvas (no en blanco)').toBe(true)

    // El summary aparece: URL del bridge + usuario = circleId. configSummary.
    // Scope a elementos VISIBLES: el circleId/URL también aparecen en otras vistas
    // ocultas (v-show), así que filtramos por visibilidad para no chocar con el
    // modo estricto de Playwright.
    await expect(page.locator('.mono:visible', { hasText: 'https://geo.dotrino.com/here' }).first())
      .toBeVisible()
    await expect(page.locator('.mono:visible', { hasText: id }).first())
      .toBeVisible()

    // La política de clave (key-policy) se muestra (propio vs tercero).
    await expect(page.getByTestId('key-policy')).toBeVisible()

    // Descargar .otrc y copiar enlace están disponibles tras generar.
    await expect(page.getByTestId('download-otrc')).toBeVisible()
    await expect(page.getByTestId('copy-payload')).toBeVisible()
  })

  // (5) La guía de OwnTracks visible: contenido real, no un placeholder vacío.
  test('muestra la guía de configuración de OwnTracks', async ({ page }) => {
    await page.getByTestId('tab-config').click()
    const guide = page.getByTestId('owntracks-guide')
    await expect(guide).toBeVisible()
    // Pasos clave de la guía (es): instalar + escanear el QR.
    await expect(guide).toContainText('Cómo configurar OwnTracks')
    await expect(guide).toContainText('OwnTracks')
    // El detalle manual (Connection) está dentro de la guía.
    await expect(guide.getByText('Modo', { exact: true })).toBeVisible()
    await expect(guide.getByText('Encryption key', { exact: true })).toBeVisible()
  })
})
