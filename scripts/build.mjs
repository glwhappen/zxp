import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'

export async function buildSite({ sites = false, outfile = 'dist/server/index.js' } = {}) {
  const client = await build({
    entryPoints: ['src/client/app.js'],
    bundle: true,
    minify: true,
    write: false,
    target: 'es2022',
    format: 'esm',
  })
  await build({
    entryPoints: ['src/server/worker.js'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile,
    define: { SITES_HOSTED: JSON.stringify(sites) },
    loader: { '.html': 'text', '.css': 'text' },
    plugins: [{
      name: 'client-bundle',
      setup(builder) {
        builder.onResolve({ filter: /^client-bundle$/ }, () => ({ path: 'client', namespace: 'client' }))
        builder.onLoad({ filter: /.*/, namespace: 'client' }, () => ({
          contents: 'export default ' + JSON.stringify(client.outputFiles[0].text),
        }))
      },
    }],
  })
  if (sites) {
    await mkdir('dist/.openai', { recursive: true })
    await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json')
  }
}

if (process.argv.includes('--sites')) await buildSite({ sites: true })
