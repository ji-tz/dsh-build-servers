import assert from 'node:assert/strict'
import test from 'node:test'

import { __test } from '../index.js'

const {
  formatBytes,
  normalizeServer,
  normalizeSettings,
  parseDisk,
  parseKeyValues,
  remotePath,
  sanitizeTerminal,
  shellQuote,
  terminalSince,
} = __test

test('shellQuote wraps and escapes a command fragment', () => {
  assert.equal(shellQuote('plain'), "'plain'")
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
})

test('remotePath expands a leading tilde but quotes the rest', () => {
  assert.equal(remotePath('~'), '"$HOME"')
  assert.equal(remotePath('~/src/my project'), '"$HOME"/\'src/my project\'')
  assert.equal(remotePath('/opt/build'), "'/opt/build'")
})

test('parseDisk reads df output and keeps the percentage', () => {
  assert.deepEqual(parseDisk('1000,400,600,40%'), {
    totalKb: 1000,
    usedKb: 400,
    availableKb: 600,
    percent: 40,
  })
  assert.equal(parseDisk(''), null)
  assert.equal(parseDisk('broken'), null)
})

test('sanitizeTerminal removes ANSI and normalizes carriage returns', () => {
  assert.equal(sanitizeTerminal('\u001b[31mred\u001b[0m\r\nnext\rline'), 'red\nnext\nline')
  assert.equal(sanitizeTerminal('a\u0007b'), 'ab')
})

test('formatBytes prints B, KB, and MB', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(10 * 1024 * 1024), '10.0 MB')
})

test('parseKeyValues keeps everything after the first equals sign', () => {
  assert.deepEqual(parseKeyValues('a=1\nb=x=y\nc='), { a: '1', b: 'x=y', c: '' })
})

test('normalizeServer accepts an alias and rejects ssh option injection', () => {
  const ok = normalizeServer({ name: 'build', target: 'build-host' }, 0, 'srv_1')
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.server.id, 'srv_1')
  assert.equal(ok.server.target, 'build-host')

  const bad = normalizeServer({ name: 'build', target: '-oProxyCommand=calc' }, 0, 'srv_2')
  assert.ok(bad.problems.length > 0)
})

test('normalizeSettings requires a remote path when uploading', () => {
  const bad = normalizeSettings({ localPath: 'D:\\src', repoPath: '' })
  assert.ok(bad.problems.length > 0)

  const ok = normalizeSettings({
    localPath: 'D:\\src',
    repoPath: '~/src/app',
    stages: { build: 'make' },
  })
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.settings.repoPath, '~/src/app')
  assert.equal(ok.settings.stages.build, 'make')
})

test('terminalSince returns only text after the cursor', () => {
  const session = { total: 6, output: 'abcdef' }
  assert.equal(terminalSince(session, 3), 'def')
  assert.equal(terminalSince(session, 0), 'abcdef')
})
