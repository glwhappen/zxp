import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16)

export async function buildSite({ sites = false, outfile = 'dist/server/index.js' } = {}) {
  const editor = await build({
    entryPoints: ['src/client/markdown-editor.js'], bundle: true, minify: true,
    write: false, target: 'es2022', format: 'esm',
  })
  const editorDigest = digest(editor.outputFiles[0].contents)
  const client = await build({
    entryPoints: ['src/client/app.js'],
    bundle: true,
    minify: true,
    write: false,
    target: 'es2022',
    format: 'esm',
    define: { MARKDOWN_EDITOR_PATH: JSON.stringify(`/assets/markdown-editor.${editorDigest}.js`) },
    external: ['/assets/*'],
  })
  await build({
    entryPoints: ['src/server/worker.js'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile,
    define: {
      SITES_HOSTED: JSON.stringify(sites),
      CLIENT_DIGEST: JSON.stringify(digest(client.outputFiles[0].contents)),
      CSS_DIGEST: JSON.stringify(digest(await readFile('src/client/style.css'))),
      EDITOR_DIGEST: JSON.stringify(editorDigest),
    },
    loader: { '.html': 'text', '.css': 'text', '.webp': 'binary', '.png': 'binary' },
    plugins: [{
      name: 'client-bundle',
      setup(builder) {
        builder.onResolve({ filter: /^client-bundle$/ }, () => ({ path: 'client', namespace: 'client' }))
        builder.onLoad({ filter: /.*/, namespace: 'client' }, () => ({
          contents: 'export default ' + JSON.stringify(client.outputFiles[0].text),
        }))
        builder.onResolve({ filter: /^editor-bundle$/ }, () => ({ path: 'editor', namespace: 'editor' }))
        builder.onLoad({ filter: /.*/, namespace: 'editor' }, () => ({
          contents: 'export default ' + JSON.stringify(editor.outputFiles[0].text),
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
