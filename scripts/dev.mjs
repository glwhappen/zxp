import { watch } from 'node:fs'
import { spawn } from 'node:child_process'
import { buildSite } from './build.mjs'

const bundle = { outfile: '.wrangler/dev/worker.js' }
await buildSite(bundle)
const server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
})
const sourceWatcher = watch('src', { recursive: true })
let timeout
let pending = Promise.resolve()
sourceWatcher.on('change', () => {
  clearTimeout(timeout)
  timeout = setTimeout(() => {
    pending = pending.then(() => buildSite(bundle)).catch(console.error)
  }, 100)
})
server.on('close', code => {
  sourceWatcher.close()
  clearTimeout(timeout)
  process.exitCode = code ?? 0
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
