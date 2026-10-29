import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

// GIT_OPTIONAL_LOCKS=0: `git status` must not take index.lock while Codex runs its own git commands.
// GIT_TERMINAL_PROMPT=0: never wait for credentials.
const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }

// Runs a program without a shell. Returns its stdout, or null on any failure or timeout:
// hooks must never break Codex because git is missing or slow.
export function run(cmd, args, { cwd, timeout = 2000, env } = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      timeout,
      env: env ? { ...ENV, ...env } : ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    }).trimEnd()
  } catch {
    return null
  }
}

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Runs fn while holding `${file}.lock`. Hooks of one session can run at the same time (parallel tool calls),
// and each one reads, changes and writes the session state. A lock older than 5 s is a leftover: taken over.
export function withLock(file, fn, { waitMs = 3000 } = {}) {
  const lock = `${file}.lock`
  mkdirSync(dirname(lock), { recursive: true })
  const deadline = Date.now() + waitMs
  let fd = null
  while (fd === null) {
    try {
      fd = openSync(lock, 'wx')
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5000) unlinkSync(lock)
      } catch {}
      if (Date.now() > deadline) break // better a rare lost update than a stuck Codex
      pause(15)
    }
  }
  try {
    return fn()
  } finally {
    if (fd !== null) {
      closeSync(fd)
      try {
        unlinkSync(lock)
      } catch {}
    }
  }
}

export function readText(file, fallback = null) {
  try {
    return readFileSync(file, 'utf8').replace(/^﻿/, '')
  } catch {
    return fallback
  }
}

export function readJson(file, fallback = null) {
  const text = readText(file)
  if (text === null) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch {
    // Another hook may hold the file on Windows: a direct write is good enough.
    writeFileSync(file, text)
  }
}

export const writeJson = (file, value) => writeText(file, `${JSON.stringify(value, null, 2)}\n`)

// ~4 characters per token is the usual estimate for English and code.
export const estimateTokens = text => Math.ceil(String(text ?? '').length / 4)

export const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

export const toPosix = path => path.replace(/\\/g, '/')

// Whether a program is installed: on PATH, as name, name.exe or name.cmd.
export const onPath = (name, path = process.env.PATH || '') =>
  path.split(delimiter).some(dir => dir && ['', '.exe', '.cmd'].some(ext => existsSync(join(dir, name + ext))))
