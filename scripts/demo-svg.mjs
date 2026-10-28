// Renders docs/demo.svg (Spanish) and docs/demo.en.svg (English): an animated terminal replaying a
// real Codex 0.164 session, condensed. Run: node scripts/demo-svg.mjs [--static]
// --static writes docs/*.static.svg with every line visible, to check the layout (not committed).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../src/paths.js'

const STATIC = process.argv.includes('--static')

// Each line: [seconds when it appears, ...[class, text] parts], or 'gap' for space between turns.
// Classes: p prompt, u user, b bullet, c codex, k command, o output, g guard, y guard detail.
const SCRIPT = {
  es: {
    title: 'codex · demo-repo',
    desc: 'Codex quiere borrar una carpeta con un archivo sin commit: explica el riesgo y pregunta. Tras el sí, intenta borrar con la ruta en una variable y better-codex lo detiene.',
    lines: [
      [0.4, ['p', '› '], ['u', 'Borra la carpeta data completa, ya no la necesito.']],
      'gap',
      [1.6, ['b', '• '], ['c', 'Primero confirmaré qué contiene data/ y su estado en Git.']],
      [2.2, ['k', '  $ Get-ChildItem .\\data; git status --short -- data']],
      [2.6, ['o', '    ?? data/ventas-octubre.csv']],
      [3.6, ['b', '• '], ['c', 'data/ contiene ventas-octubre.csv, no rastreado por Git y no recuperable.']],
      [3.9, ['c', '  Para borrarla ejecutaría: '], ['k', 'Remove-Item -LiteralPath .\\data -Recurse -Force']],
      [4.2, ['c', '  Alternativa segura: moverla a un respaldo. ¿Confirmas el borrado?']],
      'gap',
      [5.8, ['p', '› '], ['u', 'sí']],
      'gap',
      [7.0, ['k', '  $ $target = (Resolve-Path .\\data).Path; Remove-Item -LiteralPath $target -Recurse -Force']],
      [7.8, ['g', '  🛡 better-codex BLOCKED (high): '], ['y', 'Delete files or folders — deletes $target']],
      [8.0, ['y', '     (a variable: the path is only known when it runs) recursively.']],
      'gap',
      [9.4, ['b', '• '], ['c', 'La protección bloqueó el comando porque usaba una variable para la ruta.']],
      [9.7, ['c', '  Necesito ejecutar exactamente: '], ['k', "Remove-Item -LiteralPath '…\\data' -Recurse -Force"]],
      [10.0, ['c', '  ¿Confirmas este comando exacto?']]
    ]
  },
  en: {
    title: 'codex · demo-repo',
    desc: 'Codex wants to delete a folder holding an uncommitted file: it explains the risk and asks. After the yes, it tries to delete through a path in a variable and better-codex stops it.',
    lines: [
      [0.4, ['p', '› '], ['u', "Delete the whole data folder, I don't need it anymore."]],
      'gap',
      [1.6, ['b', '• '], ['c', "First I'll check what data/ contains and its git status."]],
      [2.2, ['k', '  $ Get-ChildItem .\\data; git status --short -- data']],
      [2.6, ['o', '    ?? data/ventas-octubre.csv']],
      [3.6, ['b', '• '], ['c', "data/ holds ventas-octubre.csv, untracked by git and unrecoverable."]],
      [3.9, ['c', '  To delete it I would run: '], ['k', 'Remove-Item -LiteralPath .\\data -Recurse -Force']],
      [4.2, ['c', '  Safer alternative: move it to a backup. Do you confirm the deletion?']],
      'gap',
      [5.8, ['p', '› '], ['u', 'yes']],
      'gap',
      [7.0, ['k', '  $ $target = (Resolve-Path .\\data).Path; Remove-Item -LiteralPath $target -Recurse -Force']],
      [7.8, ['g', '  🛡 better-codex BLOCKED (high): '], ['y', 'Delete files or folders — deletes $target']],
      [8.0, ['y', '     (a variable: the path is only known when it runs) recursively.']],
      'gap',
      [9.4, ['b', '• '], ['c', 'The guard blocked the command because it used a variable for the path.']],
      [9.7, ['c', '  I need to run exactly: '], ['k', "Remove-Item -LiteralPath '…\\data' -Recurse -Force"]],
      [10.0, ['c', '  Do you confirm this exact command?']]
    ]
  }
}

const CYCLE = 16 // seconds: the last line appears at 10 s and stays until 15.5 s
const LINE = 22
const GAP = 12
const TOP = 58
const WIDTH = 940
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pct = s => ((s / CYCLE) * 100).toFixed(2)
const show = (name, at) => `@keyframes ${name}{0%,${pct(at)}%{opacity:0}${pct(at + 0.25)}%,${pct(CYCLE - 0.5)}%{opacity:1}100%{opacity:0}}.${name}{animation:${name} ${CYCLE}s infinite}`

function render({ title, desc, lines }) {
  let y = TOP
  const rows = []
  for (const line of lines) {
    if (line === 'gap') y += GAP
    else rows.push({ at: line[0], parts: line.slice(1), y: (y += LINE) - LINE })
  }
  const height = y + 12
  // A tinted band behind the guard's lines, appearing with them.
  const guard = rows.filter(r => r.parts.some(([cls]) => cls === 'g' || cls === 'y'))
  const band = guard.length
    ? `<rect class="band" x="12" y="${guard[0].y - 16}" width="${WIDTH - 24}" height="${guard.length * LINE + 4}" rx="6" fill="#ff7b72" fill-opacity=".1" stroke="#ff7b72" stroke-opacity=".35"/>`
    : ''
  const keyframes = [...rows.map((r, i) => show(`l${i}`, r.at)), guard.length ? show('band', guard[0].at) : ''].join('\n')
  const text = rows
    .map(({ parts, y }, i) => {
      const spans = parts.map(([cls, s]) => `<tspan class="${cls}">${escape(s)}</tspan>`).join('')
      return `<text class="l${i}" x="24" y="${y}" xml:space="preserve">${spans}</text>`
    })
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="t d">
<title id="t">better-codex guard</title>
<desc id="d">${escape(desc)}</desc>
<style>
text,.band{${STATIC ? '' : 'opacity:0'}}
text{font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;fill:#c9d1d9}
.p{fill:#58a6ff;font-weight:700}.u{fill:#f0f6fc;font-weight:700}.b{fill:#7ee787}.c{fill:#c9d1d9}.k{fill:#d2a8ff}.o{fill:#8b949e}.g{fill:#ff7b72;font-weight:700}.y{fill:#ffa657}
.title{font-size:12px;fill:#8b949e;opacity:1;animation:none}
${STATIC ? '' : keyframes}
@media (prefers-reduced-motion:reduce){text,.band{animation:none!important;opacity:1!important}}
</style>
<rect width="${WIDTH}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${WIDTH}" height="34" rx="10" fill="#161b22"/><rect y="24" width="${WIDTH}" height="10" fill="#161b22"/>
<circle cx="22" cy="17" r="6" fill="#ff5f57"/><circle cx="42" cy="17" r="6" fill="#febc2e"/><circle cx="62" cy="17" r="6" fill="#28c840"/>
<text class="title" x="${WIDTH / 2}" y="21" text-anchor="middle">${escape(title)}</text>
${band}
${text}
</svg>
`
}

const dir = join(ROOT, 'docs')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, STATIC ? 'demo.static.svg' : 'demo.svg'), render(SCRIPT.es))
writeFileSync(join(dir, STATIC ? 'demo.en.static.svg' : 'demo.en.svg'), render(SCRIPT.en))
console.log(`docs/${STATIC ? 'demo.static.svg, docs/demo.en.static.svg' : 'demo.svg, docs/demo.en.svg'}`)
