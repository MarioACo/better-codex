import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathArgs, segments, toolCommands } from './shell.js'

// Reads that dump a whole file. head/tail, -TotalCount/-Tail and anything piped into a filter are ranged: allowed.
const FULL_READERS = new Set(['cat', 'type', 'bat', 'less', 'more', 'nl', 'get-content', 'gc'])
const RANGE_FLAG = /^-(TotalCount|Head|Tail|First|Last)$/i
const LISTERS = new Set(['ls', 'dir', 'get-childitem', 'gci', 'tree', 'find'])

export const GENERATED = /(^|[\\/])(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.angular|\.turbo|\.cache|target)[\\/]|\.min\.(js|css)$|\.map$|(^|[\\/])(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|Podfile\.lock|go\.sum|packages\.lock\.json)$/i
export const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|icns|pdf|zip|gz|tgz|7z|rar|jar|war|apk|aab|ipa|exe|dll|so|dylib|class|o|a|lib|woff2?|ttf|otf|eot|mp[34]|mov|avi|wav|ogg|sqlite3?|db|pyc|wasm)$/i

const sizeOf = file => {
  try {
    const stat = statSync(file)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

const isRecursive = seg =>
  seg.verb === 'tree' ||
  (seg.verb === 'find' && !seg.argv.includes('-maxdepth')) ||
  seg.argv.some(a => a === '-R' || /^(-recurse|-r|\/s|--recursive)$/i.test(a))

const PREFIX = '[better-codex token-diet]'
// A small generated file (an APK's output-metadata.json, a dependency's manifest) is cheap and often what you need.
const SMALL_GENERATED = 24 * 1024
// Text you pasted into Codex is saved here: always readable.
const ATTACHMENTS = /[\\/]\.codex[\\/]attachments[\\/]/i

// The first wasteful read in a tool call, or null. Files the user named in the prompt are always allowed.
export function dietCheck({ toolName, toolInput, cwd, prompt = '', maxKB = 200 }) {
  const lowerPrompt = String(prompt).toLowerCase()
  const named = path => {
    const base = path.replace(/^.*[\\/]/, '').toLowerCase()
    return base.length > 2 && lowerPrompt.includes(base)
  }
  for (const command of toolCommands(toolName, toolInput)) {
    for (const seg of segments(command)) {
      if (seg.piped) continue
      if (FULL_READERS.has(seg.verb) && !seg.argv.some(a => RANGE_FLAG.test(a))) {
        for (const path of pathArgs(seg.argv)) {
          if (named(path) || ATTACHMENTS.test(path)) continue
          if (BINARY.test(path)) {
            return { rule: 'binary', path, reason: `${PREFIX} Skipped reading ${path}: it is a binary file, so as text it is only noise. Check its size, type or metadata instead.` }
          }
          if (GENERATED.test(path)) {
            const size = sizeOf(resolve(cwd, path))
            if (size <= SMALL_GENERATED) continue
            return {
              rule: 'generated',
              path,
              savedTokens: Math.round(size / 4),
              reason: `${PREFIX} Skipped a full read of ${path}: it is generated or vendored (lockfile, build output or dependency), so reading all of it wastes context. Search it (rg -n "<term>" ${path}) or read a small range (Select-Object -First 80, head -n 80). If the user explicitly needs the whole file, say so.`
            }
          }
          const size = sizeOf(resolve(cwd, path))
          if (size > maxKB * 1024) {
            return {
              rule: 'huge',
              path,
              savedTokens: Math.round(size / 4),
              reason: `${PREFIX} Skipped a full read of ${path}: ${Math.round(size / 1024)} KB, about ${Math.round(size / 4 / 1000)}K tokens. Find the relevant part with rg -n "<term>" ${path}, then read only that line range (Get-Content ${path} | Select-Object -Skip N -First M, or sed -n 'N,Mp' ${path}).`
            }
          }
        }
      }
      if (LISTERS.has(seg.verb) && isRecursive(seg) && !/node_modules/i.test(seg.text)) {
        const target = pathArgs(seg.argv).find(a => !/^\*/.test(a)) || '.'
        if (existsSync(join(resolve(cwd, target), 'node_modules'))) {
          return {
            rule: 'listing',
            path: target,
            reason: `${PREFIX} Skipped a recursive listing of ${target}: it would walk node_modules (thousands of entries). Use rg --files${target === '.' ? '' : ` ${target}`} (it respects .gitignore), with -g "*.ts" to filter.`
          }
        }
      }
    }
  }
  return null
}
