import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boostPrompt, classify, fileHints, parseMode } from '../src/prompt.js'

test('modes: prefixes in English and Spanish, the marker is dropped', () => {
  assert.deepEqual(parseMode('+fix the parser'), { mode: 'deep', rest: 'fix the parser' })
  assert.deepEqual(parseMode('  quick: rename it'), { mode: 'quick', rest: 'rename it' })
  assert.deepEqual(parseMode('Rápido: cambia el color'), { mode: 'quick', rest: 'cambia el color' })
  assert.deepEqual(parseMode('pregunta: ¿qué hace esto?'), { mode: 'ask', rest: '¿qué hace esto?' })
  assert.equal(parseMode('plan: migrar a pnpm').mode, 'plan')
  assert.equal(parseMode('profundo: revisa el flujo').mode, 'deep')
})

test('modes: "+1", "++" and plain prompts are not modes', () => {
  assert.equal(parseMode('+1 to that').mode, null)
  assert.equal(parseMode('++i is faster?').mode, null)
  assert.equal(parseMode('+').mode, null)
  assert.equal(parseMode('fix the login').mode, null)
})

test('classify: Spanish and English tasks', () => {
  assert.equal(classify('arregla el login que truena al guardar'), 'bugfix')
  assert.equal(classify('el botón de pagar no funciona en iOS'), 'bugfix')
  assert.equal(classify('fix the crash when the list is empty'), 'bugfix')
  assert.equal(classify('la pantalla de reportes está muy lenta'), 'perf')
  assert.equal(classify('refactoriza el servicio de usuarios'), 'refactor')
  assert.equal(classify('agrega pruebas unitarias al parser'), 'test')
  assert.equal(classify('revisa el código del módulo de pagos'), 'review')
  assert.equal(classify('agrega exportar a CSV en reportes'), 'feature')
  assert.equal(classify('add error handling to the upload form'), 'feature')
  assert.equal(classify('actualiza el README con la instalación'), 'docs')
})

test('classify: questions are answered, not edited', () => {
  assert.equal(classify('¿por qué falla el build en CI?'), 'question')
  assert.equal(classify('cómo funciona la autenticación aquí'), 'question')
  assert.equal(classify('what does the cache layer do'), 'question')
  // a question that asks for a change is a change
  assert.equal(classify('¿puedes arreglar el login que no carga?'), 'bugfix')
})

test('classify: short follow-ups get nothing', () => {
  assert.equal(classify('sí, dale'), null)
  assert.equal(classify('continúa'), null)
})

const FILES = ['src/auth/login.ts', 'src/auth/login.test.ts', 'src/utils/format.ts', 'src/reports/ReportTable.tsx', 'src/payments/checkout-service.ts', 'docs/setup.md', 'node_modules/x/login.js', 'package.json']

test('fileHints: names, paths and stack frames become real paths', () => {
  assert.deepEqual(fileHints('el login falla', FILES).slice(0, 2).sort(), ['src/auth/login.test.ts', 'src/auth/login.ts'].sort())
  assert.ok(fileHints('the `ReportTable` renders twice', FILES).includes('src/reports/ReportTable.tsx'))
  assert.ok(fileHints('TypeError at format (format.ts:12:5)', FILES).includes('src/utils/format.ts'))
  // a stack frame that already carries the full path needs no hint
  assert.ok(!fileHints('at format (webpack:///src/utils/format.ts:12:5)', FILES).includes('src/utils/format.ts'))
  assert.ok(fileHints('checkout-service throws on retry', FILES).includes('src/payments/checkout-service.ts'))
  assert.ok(fileHints('revisa la carpeta auth', FILES).includes('src/auth/'))
})

test('fileHints: skips generated files, paths already written out, and noise', () => {
  assert.ok(!fileHints('login', FILES).some(f => f.startsWith('node_modules')))
  assert.deepEqual(fileHints('look at src/auth/login.ts please', FILES).filter(f => f === 'src/auth/login.ts'), [])
  assert.deepEqual(fileHints('quiero que esta pantalla sea más bonita', FILES), [])
})

test('boostPrompt: a playbook is given once per session', () => {
  const first = boostPrompt('arregla el login que truena', { files: FILES })
  assert.equal(first.task, 'bugfix')
  assert.match(first.text, /Bug fix:/)
  const again = boostPrompt('arregla el logout que truena', { files: FILES, seen: ['bugfix'] })
  assert.doesNotMatch(again.text, /Bug fix:/)
})

test('boostPrompt: ask and plan modes never get an editing playbook', () => {
  const r = boostPrompt('plan: arregla el login que truena', { files: [] })
  assert.equal(r.mode, 'plan')
  assert.equal(r.task, null)
  assert.match(r.text, /Mode PLAN/)
})

test('boostPrompt: stays small', () => {
  const r = boostPrompt('+arregla el login que truena cuando `ReportTable` carga checkout-service', { files: FILES })
  assert.ok(r.text.length <= 1200)
})
