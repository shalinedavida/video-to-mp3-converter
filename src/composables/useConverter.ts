import { ref, shallowRef } from 'vue'
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

export type OutputFormat = 'mp3' | 'm4r'

export interface ConvertOptions {
  file: File
  format: OutputFormat
  bitrate: string          // e.g. "128k"
  start: number            // seconds
  duration?: number        // clip length in seconds; undefined = rest of file
  totalDuration: number    // source duration in seconds (0 if unknown)
}

const MIME: Record<OutputFormat, string> = { mp3: 'audio/mpeg', m4r: 'audio/mp4' }

let ffmpeg = new FFmpeg()
let loaded = false
let loading: Promise<void> | null = null

async function ensureLoaded() {
  if (loaded) return
  loading ??= (async () => {
    await ffmpeg.load({
      coreURL: await toBlobURL(coreURL, 'text/javascript'),
      wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
    })
    loaded = true
  })().finally(() => { loading = null })
  await loading
}

export function useConverter() {
  const status = ref<'idle' | 'loading' | 'converting' | 'done' | 'error'>('idle')
  const progress = ref(0)
  const error = ref('')
  const result = shallowRef<Blob | null>(null)
  let cancelled = false

  /** Warm up the engine (~30 MB wasm) while the user is still choosing options. */
  function preload() {
    ensureLoaded().catch(() => { /* surfaced on convert() */ })
  }

  function cancel() {
    if (status.value !== 'converting' && status.value !== 'loading') return
    cancelled = true
    ffmpeg.terminate()
    ffmpeg = new FFmpeg()
    loaded = false
    loading = null
    status.value = 'idle'
    progress.value = 0
  }

  function reset() {
    result.value = null
    error.value = ''
    progress.value = 0
    status.value = 'idle'
  }

  async function convert(opts: ConvertOptions) {
    cancelled = false
    reset()
    const instance = ffmpeg
    const out = `out.${opts.format}`
    const total = opts.duration ?? Math.max(0, opts.totalDuration - opts.start)
    let inputPath = ''
    let mounted = false

    const onProgress = ({ progress: p, time }: { progress: number; time: number }) => {
      const ratio = total > 0 && time > 0 ? time / 1e6 / total : p
      progress.value = Math.min(99, Math.max(0, Math.round(ratio * 100)))
    }

    try {
      status.value = 'loading'
      await ensureLoaded()
      status.value = 'converting'
      instance.on('progress', onProgress)

      // Mount the file instead of copying it into memory (much better for big videos).
      try {
        await instance.createDir('/in')
        await instance.mount(FFFSType.WORKERFS, { files: [opts.file] }, '/in')
        mounted = true
        inputPath = `/in/${opts.file.name}`
      } catch {
        inputPath = 'input.' + (opts.file.name.split('.').pop() || 'bin')
        await instance.writeFile(inputPath, await fetchFile(opts.file))
      }

      const args = ['-ss', String(opts.start), '-i', inputPath]
      if (opts.duration) args.push('-t', String(opts.duration))
      args.push('-vn', '-map', '0:a:0')
      if (opts.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', opts.bitrate)
      else args.push('-c:a', 'aac', '-b:a', opts.bitrate, '-f', 'ipod')
      args.push(out)

      const code = await instance.exec(args)
      if (code !== 0) throw new Error('Could not convert this file. It may be unsupported or have no audio track.')

      const data = await instance.readFile(out)
      result.value = new Blob([data as BlobPart], { type: MIME[opts.format] })
      progress.value = 100
      status.value = 'done'
    } catch (e) {
      if (cancelled) return
      error.value = e instanceof Error ? e.message : 'Something went wrong. Please try again.'
      status.value = 'error'
    } finally {
      instance.off('progress', onProgress)
      if (!cancelled) {
        if (mounted) {
          await instance.unmount('/in').catch(() => {})
          await instance.deleteDir('/in').catch(() => {})
        } else if (inputPath) {
          await instance.deleteFile(inputPath).catch(() => {})
        }
        await instance.deleteFile(out).catch(() => {})
      }
    }
  }

  return { status, progress, error, result, convert, cancel, preload, reset }
}
