# Here — configurador de OwnTracks para Dotrino

**`here.dotrino.com`** es el **configurador** del pilar **geo** del ecosistema
[Dotrino](https://dotrino.com/): arma **círculos** privados de ubicación,
emite **permisos firmados por dispositivo** (caps) y genera la **config de
OwnTracks** lista para escanear por QR / importar como `.otrc`.

> *Tu información, en tu servidor, bajo tus reglas.* La ubicación viaja **cifrada
> de extremo a extremo** entre los miembros del círculo; el servidor (bridge) solo
> ve ciphertext opaco y un agrupamiento por círculo, **nunca** dónde estás.

OwnTracks (background) y el **bridge** de geo corren solos, **cerrados y
cifrados**; **"here" no necesita estar abierto**. El **mapa lo pone OwnTracks**.
Esta app es **config-only** (puede estar cerrada / privada).

## Qué hace (y qué NO hace)

`here` **solo configura**. Tres pantallas (esqueleto de UI, sin lógica de
servidor en este scaffold):

1. **Círculos** — listar / crear círculos; agregar miembros desde los
   **contactos del vault** (`id.dotrino.com`). Cada círculo tiene una **clave
   simétrica** (la *Encryption key* de OwnTracks) que solo conocen sus miembros.
2. **Dispositivos** — **parear** un teléfono/tablet:
   `makeDeviceKey()` (sub-clave del dispositivo; la maestra nunca la ve) +
   `signDelegation(devicePublickey, ['geo:publish', 'geo:read:<circleId>'])`
   firmado por el **vault**. Caducidad + revocación.
3. **Generar config** — compone la config de OwnTracks (modo HTTP) y la muestra
   como **QR** (autohosteado, sin servicios de terceros) + archivo **`.otrc`**.

**NO** implementa el **bridge** ni el **server** (eso vive en
`dotrino-geo`, ruta `POST /here`, cerrado y aditivo). `here` no llama al
servidor: solo arma credenciales y la config; OwnTracks publica solo.

## Arquitectura / contrato

```
circleId = pubkeyId(ownerMasterPubkey) + ':' + slug
```

El bridge cerrado liga el círculo a su **dueño**: exige que `pubkeyId(cert.iss)`
=== `circleId.split(':')[0]`. Cada dispositivo publica con un **cap** firmado por
el vault del dueño con scope `geo:publish` + `geo:read:<circleId>`.

**Config de OwnTracks que `here` genera** (modo HTTP):

| Campo            | Valor                                             |
|------------------|---------------------------------------------------|
| URL              | `https://geo.dotrino.com/here`                   |
| Auth             | HTTP Basic                                         |
| username         | `circleId`                                         |
| password         | `base64url(JSON.stringify(cert))` (cap delegado)  |
| Encryption key   | clave del círculo (libsodium secretbox)           |
| tid / deviceId   | del dispositivo                                    |

El bridge guarda el **último** blob por miembro (TTL + overwrite, **efímero**, sin
historial) y responde con los blobs recientes de los **otros** miembros del
**mismo** círculo → OwnTracks los pinta como amigos. **Jamás** broadcast, jamás
cross-círculo, jamás acceso anónimo, jamás proximidad/descubrimiento (canal
separado del pin-store ABIERTO de discovery — Trueque/Eco).

## Stack

- **Vite + Vue 3** (norma del ecosistema, plantilla `gridgame`; `base: './'`).
- **`@dotrino/identity` v0.10.0** — única fuente de identidad:
  - `Identity.connect()` (vault iframe), `signData`, `signDelegation`,
    `revokeDelegation`, `listDelegations`, `listContacts`.
  - Subpath ESM puro `@dotrino/identity/capabilities`:
    `makeDeviceKey`, `pubkeyId`.
- **`@dotrino/support`** — moneda de soporte (§6).
- **`@dotrino/nav`** — botón "volver" unificado.
- **`qrcode`** — render del QR de config en el cliente (sin terceros).
- PWA (manifest + `sw.js` + iconos), SEO/OG/JSON-LD, GoatCounter cookieless,
  bilingüe es/en (tuteo). Ver `CONVENCIONES-APPS.md`.

## TODO (cableado pendiente, fuera de este scaffold)

- **Cifrado y reparto de la clave del círculo** — `src/lib/circles.js`
  (`distributeCircleKey`): cifrar la clave con `identity.encrypt([memberEncPubkey],
  key)` y repartirla por el **proxy** (`@dotrino/proxy-client`) o
  por deep-link `#fragment`; no guardarla en claro. Marcado con `TODO(cifrado)`.
- **Llamada al bridge** — `here` no la hace (OwnTracks publica). El bridge es la
  ruta `POST /here` en `dotrino-geo` (cerrado, aditivo). Marcado
  `TODO(bridge)`.
- **Persistencia en el store** — `@dotrino/store` en lugar del
  repo en memoria de `src/lib/circles.js`. Marcado `TODO(store)`.
- **Perfil** — montar `<dotrino-profile mode="self">` con
  `createVaultProfileProvider({ identity, reputation })`. Marcado `TODO(profile)`.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3120
npm run build    # → dist/  (lo que publica Pages)
```

## Despliegue

Repo en la org **`dotrino/`**, subdominio **`here.dotrino.com`** (GitHub
Pages, deploy por **GitHub Actions** — `.github/workflows/deploy.yml`). Seguir
`CONVENCIONES-APPS.md` §11 (push HTTPS; cname al final).

## Pendiente — registro en el catálogo del ecosistema

> **NO se ha registrado todavía en el catálogo** (`dotrino-home/src/App.vue`),
> a propósito (este scaffold no toca ese repo). Para lanzar la app hay que, según
> `CONVENCIONES-APPS.md` §11.4:
>
> 1. Copiar `public/icon.svg` → `dotrino-home/src/assets/apps/here.svg`.
> 2. En `dotrino-home/src/App.vue`: `import hereLogo from './assets/apps/here.svg'`
>    y añadir al array `apps`:
>    ```js
>    {
>      name: 'Here',
>      url: 'https://here.dotrino.com/',
>      logo: hereLogo,
>      repo: 'imdotrino/dotrino-here',
>      cat: 'apps',
>      desc: {
>        es: 'Ubicación familiar cifrada: círculos privados + config de OwnTracks por QR.',
>        en: 'Encrypted family location: private circles + OwnTracks config by QR.',
>      },
>      wip: true,   // mientras el bridge/cifrado estén pendientes
>    }
>    ```
> 3. `npm run build` (verificar bundle) + push a `main`.

---

Parte del ecosistema **Dotrino**. Ko-fi:
[ko-fi.com/dotrino](https://ko-fi.com/dotrino) ·
Discord: [discord.gg/D648uq7cth](https://discord.gg/D648uq7cth)
