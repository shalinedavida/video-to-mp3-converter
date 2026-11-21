<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useConverter, type OutputFormat } from './composables/useConverter'

const MAX_RINGTONE = 30
const WARN_BYTES = 300 * 1024 * 1024
const MAX_BYTES = 1024 * 1024 * 1024

const { status, progress, error, result, convert, cancel, preload, reset } = useConverter()

const file = ref<File | null>(null)
const fileNotice = ref('')
const videoDuration = ref(0)
const ringtoneMode = ref(true)
const format = ref<OutputFormat>('mp3')
const start = ref(0)
const length = ref(MAX_RINGTONE)
const bitrate = ref('128k')
const dragging = ref(false)
const audioUrl = ref('')
let wakeLock: WakeLockSentinel | null = null

const busy = computed(() => status.value === 'loading' || status.value === 'converting')
const baseName = computed(() => {
  const n = (file.value?.name ?? '').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().slice(0, 60)
  return n || 'ringtone'
})
const outName = computed(() => `${baseName.value}.${format.value}`)
const startInvalid = computed(() => videoDuration.value > 0 && start.value >= videoDuration.value)

async function pick(f: File | undefined | null) {
  fileNotice.value = ''
  if (!f) return
  if (!f.type.startsWith('video/') && !f.type.startsWith('audio/')) {
    fileNotice.value = 'That doesn’t look like a video file. Please choose a video (MP4, MOV, MKV, WebM…).'
    return
  }
  if (f.size > MAX_BYTES) {
    fileNotice.value = 'This file is over 1 GB, which is too large to convert in a browser. Try a shorter video.'
    return
  }
  if (f.size > WARN_BYTES) {
    fileNotice.value = 'This is a large file. Conversion may be slow or fail on older phones.'
  }
  reset()
  file.value = f
  start.value = 0
  length.value = MAX_RINGTONE
  videoDuration.value = await readDuration(f)
  preload()
}

function readDuration(f: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(f)
    const v = document.createElement('video')
    v.preload = 'metadata'
    const done = (d: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0) }
    v.onloadedmetadata = () => done(v.duration)
    v.onerror = () => done(0)
    v.src = url
  })
}

function onDrop(e: DragEvent) {
  dragging.value = false
  pick(e.dataTransfer?.files?.[0])
}

async function run() {
  if (!file.value || startInvalid.value) return
  try { wakeLock = await navigator.wakeLock?.request('screen') } catch { /* optional */ }
  await convert({
    file: file.value,
    format: format.value,
    bitrate: bitrate.value,
    start: Math.max(0, start.value || 0),
    duration: ringtoneMode.value ? Math.min(Math.max(1, length.value || MAX_RINGTONE), MAX_RINGTONE) : undefined,
    totalDuration: videoDuration.value,
  })
  wakeLock?.release().catch(() => {})
  wakeLock = null
}

const warnLeave = (e: BeforeUnloadEvent) => { if (busy.value) e.preventDefault() }
window.addEventListener('beforeunload', warnLeave)

watch(result, (blob) => {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = blob ? URL.createObjectURL(blob) : ''
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', warnLeave)
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400'
</script>

<template>
  <main class="min-h-screen bg-slate-950 text-slate-100">
    <div class="mx-auto max-w-2xl px-4 py-10">
      <header class="mb-8 text-center">
        <h1 class="text-3xl font-bold sm:text-4xl">Video → Ringtone</h1>
        <p class="mt-2 text-slate-400">
          Turn any video into an MP3 or iPhone ringtone. Free, no sign-up, and your files never leave your device.
        </p>
      </header>

      <!-- Drop zone -->
      <label
        class="block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition focus-within:outline-2 focus-within:outline-violet-400"
        :class="dragging ? 'border-violet-400 bg-violet-500/10' : 'border-slate-700 hover:border-slate-500'"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input type="file" accept="video/*,audio/*" class="sr-only" :disabled="busy"
          @change="pick(($event.target as HTMLInputElement).files?.[0])" />
        <p v-if="!file" class="text-lg">Tap to choose a video, or drop it here</p>
        <div v-else>
          <p class="break-all font-medium">{{ file.name }}</p>
          <p class="text-sm text-slate-400">
            {{ (file.size / 1024 / 1024).toFixed(1) }} MB<span v-if="videoDuration"> · {{ fmt(videoDuration) }}</span>
          </p>
          <p class="mt-1 text-xs text-violet-400">Tap to change</p>
        </div>
      </label>
      <p v-if="fileNotice" class="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300" role="alert">{{ fileNotice }}</p>

      <!-- Options -->
      <section v-if="file" class="mt-6 space-y-4 rounded-2xl bg-slate-900 p-5" aria-label="Conversion options">
        <fieldset>
          <legend class="mb-2 text-sm text-slate-400">Output format</legend>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" :class="[focus, 'rounded-lg px-3 py-2 text-sm', format === 'mp3' ? 'bg-violet-600' : 'bg-slate-800']"
              :aria-pressed="format === 'mp3'" :disabled="busy" @click="format = 'mp3'">MP3 <span class="block text-xs opacity-70">Android &amp; everything else</span></button>
            <button type="button" :class="[focus, 'rounded-lg px-3 py-2 text-sm', format === 'm4r' ? 'bg-violet-600' : 'bg-slate-800']"
              :aria-pressed="format === 'm4r'" :disabled="busy" @click="format = 'm4r'">M4R <span class="block text-xs opacity-70">iPhone ringtone</span></button>
          </div>
        </fieldset>

        <label class="flex items-center gap-3">
          <input v-model="ringtoneMode" type="checkbox" class="h-5 w-5 accent-violet-500" :disabled="busy" />
          <span>Ringtone clip (max {{ MAX_RINGTONE }} seconds)</span>
        </label>

        <div v-if="ringtoneMode" class="grid grid-cols-2 gap-4">
          <label class="text-sm text-slate-400">
            Start (seconds)
            <input v-model.number="start" type="number" min="0" :disabled="busy" inputmode="numeric"
              :class="[focus, 'mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-slate-100']" />
          </label>
          <label class="text-sm text-slate-400">
            Length (seconds)
            <input v-model.number="length" type="number" min="1" :max="MAX_RINGTONE" :disabled="busy" inputmode="numeric"
              :class="[focus, 'mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-slate-100']" />
          </label>
        </div>
        <p v-if="startInvalid" class="text-sm text-red-300" role="alert">Start time is past the end of the video.</p>

        <label class="block text-sm text-slate-400">
          Quality
          <select v-model="bitrate" :disabled="busy" :class="[focus, 'mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-slate-100']">
            <option value="96k">Small (96 kbps)</option>
            <option value="128k">Standard (128 kbps)</option>
            <option value="192k">High (192 kbps)</option>
            <option value="256k">Best (256 kbps)</option>
          </select>
        </label>

        <div class="flex gap-2">
          <button :class="[focus, 'flex-1 rounded-xl bg-violet-600 py-3 font-semibold transition hover:bg-violet-500 disabled:opacity-50']"
            :disabled="busy || startInvalid" @click="run">
            {{ status === 'loading' ? 'Loading converter…' : status === 'converting' ? `Converting… ${progress}%` : `Convert to ${format.toUpperCase()}` }}
          </button>
          <button v-if="busy" :class="[focus, 'rounded-xl bg-slate-800 px-4 font-medium hover:bg-slate-700']" @click="cancel">Cancel</button>
        </div>

        <div v-if="busy" class="h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar"
          :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full bg-violet-500 transition-all" :style="{ width: (status === 'loading' ? 5 : progress) + '%' }" />
        </div>

        <p v-if="status === 'error'" class="rounded-lg bg-red-500/10 p-3 text-sm text-red-300" role="alert">{{ error }}</p>
      </section>

      <!-- Result -->
      <section v-if="status === 'done' && audioUrl" class="mt-6 space-y-4 rounded-2xl bg-slate-900 p-5" aria-live="polite">
        <h2 class="text-lg font-semibold">Your {{ format.toUpperCase() }} is ready 🎉</h2>
        <audio :src="audioUrl" controls class="w-full" />
        <a :href="audioUrl" :download="outName"
          :class="[focus, 'block w-full rounded-xl bg-emerald-600 py-3 text-center font-semibold hover:bg-emerald-500']">
          Download {{ outName }}
        </a>

        <details class="text-sm text-slate-300">
          <summary class="cursor-pointer font-medium">How to set it as your ringtone</summary>
          <div class="mt-3 space-y-3 text-slate-400">
            <div>
              <p class="font-medium text-slate-200">Android (use MP3)</p>
              <p>Download the file, then go to Settings → Sound → Phone ringtone → Add (or “My sounds”) and pick it.
                Menu names vary by brand. Or move the file into the <code>Ringtones</code> folder with your Files app.</p>
            </div>
            <div>
              <p class="font-medium text-slate-200">iPhone (use M4R)</p>
              <p>iOS can’t set a ringtone straight from a download. Connect your iPhone to a Mac (Finder) or Windows PC
                (Apple Devices app) and drag the .m4r file onto it, then choose it in Settings → Sounds &amp; Haptics → Ringtone.
                Alternatively, open an MP3 in GarageBand on the phone and use Share → Ringtone.</p>
            </div>
          </div>
        </details>
      </section>

      <footer class="mt-10 space-y-1 text-center text-xs text-slate-500">
        <p>Conversion runs in your browser using FFmpeg (WebAssembly). Nothing is uploaded.</p>
        <p>Only convert videos you own or have permission to use.</p>
      </footer>
    </div>
  </main>
</template>
