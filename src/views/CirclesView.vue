<script setup>
// Pantalla CÍRCULOS — listar / crear, agregar miembros desde los contactos del
// vault. ESQUELETO: la persistencia real (store) y el reparto cifrado de la
// clave del círculo quedan como TODO.
import { ref, computed } from 'vue'
import { listVaultContacts, getMyPubkey, getIdentity } from '@/lib/identity'
import {
  slugify, deriveCircleId, generateCircleKey, distributeCircleKey,
  circlesList, saveCircle, deleteCircle
} from '@/lib/circles'

const props = defineProps({ t: Object })

const circles = circlesList   // store reactivo compartido
const newName = ref('')
const selectedId = ref(null)
const contactsOpen = ref(false)
const contacts = ref([])

const selected = computed(() => circles.value.find(c => c.id === selectedId.value) || null)

function refresh () { /* store reactivo: no hace falta refrescar manualmente */ }

async function createCircle () {
  const name = newName.value.trim()
  if (!name) return
  const owner = getMyPubkey()
  const slug = slugify(name)
  // Sin vault → owner desconocido: usamos un placeholder local (modo demo). El
  // circleId real se liga al pubkey maestro cuando hay identidad.
  const ownerKey = owner || 'demo-owner'
  const id = owner ? await deriveCircleId(owner, slug) : `demo:${slug}`
  const circle = {
    id, slug, name,
    ownerPubkey: ownerKey,
    key: generateCircleKey(),     // TODO(cifrado): no guardar en claro; cifrar al vault
    members: [],
    devices: [],
    createdAt: Date.now()
  }
  saveCircle(circle)              // TODO(store): persistir en store.dotrino.com
  newName.value = ''
  refresh()
  selectedId.value = id
}

function removeCircle (id) {
  deleteCircle(id)
  if (selectedId.value === id) selectedId.value = null
  refresh()
}

/**
 * Reparte la clave del círculo a sus miembros CIFRADA (identity.encrypt per
 * destinatario). El cifrado es real; el ENVÍO por transporte queda como punto de
 * extensión dentro de distributeCircleKey (proxy / deep-link). No expone la clave.
 */
async function distributeKey (circle) {
  const identity = getIdentity()
  if (!identity) return                       // sin vault no hay con qué cifrar (demo)
  // El lib usa `publickey` (consistente con contactos/vault); el círculo guarda `pubkey`.
  const members = (circle.members || [])
    .filter(m => m.encryptionPubkey)
    .map(m => ({ publickey: m.pubkey, encryptionPubkey: m.encryptionPubkey, nickname: m.name }))
  if (!members.length) return                 // nadie con clave de cifrado todavía
  try {
    await distributeCircleKey({ circleKey: circle.key, members, identity })
  } catch (e) { console.warn('[here] distributeCircleKey', e) }
}

async function regenKey (circle) {
  circle.key = generateCircleKey()  // rota la clave
  saveCircle(circle)
  refresh()
  await distributeKey(circle)       // re-reparte CIFRADA a los miembros
}

async function openContacts () {
  contacts.value = await listVaultContacts()
  contactsOpen.value = true
}

async function addMember (circle, contact) {
  if (circle.members.some(m => m.pubkey === contact.publickey)) return
  circle.members.push({
    pubkey: contact.publickey,
    // guardamos la clave de cifrado del contacto: con ella se le reparte CIFRADA
    // la clave del círculo (identity.encrypt a su encryptionPubkey).
    encryptionPubkey: contact.encryptionPubkey || null,
    name: contact.nickname || contact.displayName || '',
    tid: ''
  })
  saveCircle(circle)
  refresh()
  await distributeKey(circle)  // reparte la clave CIFRADA al nuevo miembro
}

function removeMember (circle, pubkey) {
  circle.members = circle.members.filter(m => m.pubkey !== pubkey)
  saveCircle(circle)
  refresh()
}
</script>

<template>
  <div class="stack">
    <div class="card">
      <h2>{{ t.circlesTitle }}</h2>
      <p class="muted">{{ t.intro }}</p>

      <div class="row wrap" style="margin-top:10px">
        <input v-model="newName" :placeholder="t.circleNamePlaceholder"
               data-testid="circle-name" @keyup.enter="createCircle" />
        <button class="primary" data-testid="create-circle" @click="createCircle">
          {{ t.create }}
        </button>
      </div>
    </div>

    <p v-if="circles.length === 0" class="muted">{{ t.circlesEmpty }}</p>

    <div v-for="c in circles" :key="c.id" class="card" :data-circle-id="c.id">
      <div class="row">
        <div>
          <div class="title">{{ c.name }}</div>
          <div class="mono">{{ c.id }}</div>
        </div>
        <div class="spacer"></div>
        <button class="danger ghost" :data-testid="`del-${c.slug}`" @click="removeCircle(c.id)">
          {{ t.remove }}
        </button>
      </div>

      <!-- Clave del círculo -->
      <div class="banner" style="margin-top:12px">
        <strong>{{ t.circleKey }}</strong>
        <div class="mono" :data-testid="`key-${c.slug}`">{{ c.key }}</div>
        <p class="muted" style="margin:6px 0 8px">{{ t.circleKeyHint }}</p>
        <button class="ghost" @click="regenKey(c)">{{ t.regenKey }}</button>
        <!-- TODO(cifrado): repartir la clave a cada miembro con identity.encrypt + proxy. -->
      </div>

      <!-- Miembros -->
      <h2 style="margin-top:14px">{{ t.members }} ({{ c.members.length }})</h2>
      <ul class="list">
        <li v-for="m in c.members" :key="m.pubkey" class="list-item" :data-member="m.pubkey">
          <div>
            <div class="title">{{ m.name || m.pubkey.slice(0, 16) + '…' }}</div>
            <div class="sub mono">{{ m.pubkey.slice(0, 24) }}…</div>
          </div>
          <div class="spacer"></div>
          <button class="ghost danger" @click="removeMember(c, m.pubkey)">{{ t.remove }}</button>
        </li>
      </ul>

      <button class="ghost" style="margin-top:8px"
              :data-testid="`add-members-${c.slug}`"
              @click="selectedId = c.id; openContacts()">
        + {{ t.addFromContacts }}
      </button>
    </div>

    <!-- Selector de contactos del vault -->
    <div v-if="contactsOpen && selected" class="card">
      <div class="row">
        <h2>{{ t.contactsTitle }}</h2>
        <div class="spacer"></div>
        <button class="ghost" @click="contactsOpen = false">{{ t.no }}</button>
      </div>
      <p v-if="contacts.length === 0" class="muted">{{ t.contactsEmpty }}</p>
      <ul class="list">
        <li v-for="ct in contacts" :key="ct.publickey"
            class="list-item selectable" :data-contact="ct.publickey"
            @click="addMember(selected, ct)">
          <div>
            <div class="title">{{ ct.nickname || ct.displayName || ct.publickey.slice(0, 16) + '…' }}</div>
            <div class="sub mono">{{ ct.publickey.slice(0, 24) }}…</div>
          </div>
          <div class="spacer"></div>
          <span class="pill">{{ t.add }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
