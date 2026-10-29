import { statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { gitFiles, gitRoot } from './git.js'
import { readJson, readText, run, toPosix } from './util.js'
import { CODE_EXT } from './verify.js'

// What a change leaves behind that nobody asked for, read from the diff without the model: debugging,
// focused or skipped tests, conflict markers, new TODOs. Only what this change added counts: a line that
// already had a TODO and was edited is not new.

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i
const ISSUES = [
  { issue: 'merge conflict marker', re: /^(<{7}|>{7}|={7})( |$)/ },
  { issue: 'debugger statement', re: /^\s*debugger\s*;?\s*$/, code: true },
  { issue: 'breakpoint left in', re: /\b(pdb|ipdb)\.set_trace\(\)|^\s*breakpoint\(\)|\bbinding\.pry\b|^\s*byebug\b|\bvar_dump\(|^\s*dd\(/, code: true },
  { issue: 'debug print', re: /\bconsole\.(log|debug)\(\s*['"`](debug|here|aqu[ií]|test|xxx+|>>>|===|---)|\bprint\(\s*['"](debug|here|aqu[ií]|xxx+|>>>)/i, code: true },
  { issue: 'focused test (only)', re: /\b(it|test|describe|context)\.only\s*\(|^\s*f(it|describe)\s*\(/, test: true },
  { issue: 'skipped test', re: /\b(it|test|describe)\.skip\s*\(|^\s*x(it|describe)\s*\(|@pytest\.mark\.skip|@Disabled\b|\bt\.Skip\(/, test: true },
  { issue: 'new TODO', re: /\b(TODO|FIXME|XXX|HACK)\b/, code: true }
]

// Lines added and removed per file, from git (tracked files) or the whole file (new, untracked ones).
function changedLines(root, files) {
  const out = new Map(files.map(f => [f, { added: [], removed: [] }]))
  const diff = run('git', ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', ...files], { cwd: root, timeout: 4000 }) || ''
  let file = null
  let line = 0
  for (const text of diff.split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(text)
    if (header) file = out.get(header[1]) ? header[1] : null
    else if (/^\+\+\+ /.test(text)) file = null
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text)
    if (hunk) line = Number(hunk[1])
    else if (file && text.startsWith('+') && !text.startsWith('+++')) out.get(file).added.push({ line: line++, text: text.slice(1) })
    else if (file && text.startsWith('-') && !text.startsWith('---')) out.get(file).removed.push(text.slice(1))
  }
  const tracked = new Set(diff.match(/^\+\+\+ b\/.+$/gm)?.map(h => h.slice(6)) || [])
  for (const f of files) {
    if (tracked.has(f) || out.get(f).added.length) continue
    try {
      if (statSync(join(root, f)).size > 256 * 1024) continue
    } catch {
      continue
    }
    if (run('git', ['ls-files', '--error-unmatch', '--', f], { cwd: root }) !== null) continue // tracked, unchanged
    out.get(f).added = readText(join(root, f), '').split(/\r?\n/).map((text, i) => ({ line: i + 1, text }))
  }
  return out
}

// [{ file, line, issue }] for the files this turn edited.
export function reviewChanges(cwd, edited) {
  const root = gitRoot(cwd)
  if (!root || !edited.length) return []
  const files = [...new Set(edited.map(f => toPosix(relative(root, isAbsolute(f) ? f : resolve(cwd, f)))))].filter(f => f && !f.startsWith('..')).slice(0, 30)
  const found = []
  for (const [file, { added, removed }] of changedLines(root, files)) {
    const code = CODE_EXT.test(file)
    const test = TEST_FILE.test(file)
    for (const check of ISSUES) {
      if ((check.code && !code) || (check.test && !test)) continue
      const hits = added.filter(l => check.re.test(l.text))
      // A TODO that was already there and moved or got edited is not new.
      const before = removed.filter(text => check.re.test(text)).length
      for (const hit of hits.slice(before, before + 3)) found.push({ file, line: hit.line, issue: check.issue })
    }
  }
  return found.slice(0, 8)
}

// The tests for the files that changed: src/cart.js → test/cart.test.js. With the command that runs only
// them, when the project's runner is known; null otherwise.
export function focusedTests(cwd, edited, verify) {
  const root = gitRoot(cwd)
  if (!root || !verify) return null
  const all = gitFiles(root)
  const rel = edited.map(f => toPosix(relative(root, isAbsolute(f) ? f : resolve(cwd, f)))).filter(f => CODE_EXT.test(f))
  const tests = new Set(rel.filter(f => TEST_FILE.test(f)))
  for (const f of rel.filter(f => !TEST_FILE.test(f))) {
    const stem = f.slice(f.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase()
    for (const t of all) {
      const name = t.slice(t.lastIndexOf('/') + 1).toLowerCase()
      if (TEST_FILE.test(t) && (name.startsWith(`${stem}.test.`) || name.startsWith(`${stem}.spec.`) || name === `test_${stem}.py` || name === `${stem}_test.py` || name === `${stem}_test.go`)) tests.add(t)
    }
  }
  const list = [...tests].filter(t => all.includes(t)).slice(0, 6)
  if (!list.length) return null
  const script = String(readJson(join(root, 'package.json'), {})?.scripts?.test || '')
  const runner = `${verify} ${script}`
  if (/\bnode\s+--test\b/.test(runner)) return `node --test ${list.join(' ')}`
  if (/\bvitest\b/.test(runner)) return `npx vitest run ${list.join(' ')}`
  if (/\bjest\b/.test(runner)) return `npx jest ${list.join(' ')}`
  if (/\bmocha\b/.test(runner)) return `npx mocha ${list.join(' ')}`
  if (/\bpytest\b/.test(runner)) return `pytest ${list.join(' ')}`
  if (/\bgo\s+test\b/.test(runner)) return `go test ${[...new Set(list.map(t => `./${t.includes('/') ? t.slice(0, t.lastIndexOf('/')) : '.'}`))].join(' ')}`
  return null
}
