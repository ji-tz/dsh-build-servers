import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { __test, apply } from '../index.js'

const {
  buildPathFor,
  stageCommandFor,
  formatBytes,
  normalizeServer,
  normalizeSettings,
  parseDisk,
  parseKeyValues,
  remotePath,
  sanitizeTerminal,
  shellQuote,
  terminalRawSince,
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
    syncPath: '~/src/app',
    buildPath: '~/src/app/out',
    stages: { configure: 'cmake ..', build: 'cmake --build . -j32' },
  })
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.settings.syncPath, '~/src/app')
  assert.equal(ok.settings.buildPath, '~/src/app/out')
  assert.equal(ok.settings.stages.configure, 'cmake ..')
  assert.equal(ok.settings.stages.build, 'cmake --build . -j32')
})

test('normalizeSettings migrates a legacy repoPath to syncPath', () => {
  const migrated = normalizeSettings({ localPath: 'D:\\src', repoPath: '~/src/app' })
  assert.deepEqual(migrated.problems, [])
  assert.equal(migrated.settings.syncPath, '~/src/app')
  assert.equal(migrated.settings.buildPath, '')
})

test('buildPathFor defaults to the sync path build subdirectory', () => {
  assert.equal(buildPathFor({ syncPath: '~/src/app' }), '~/src/app/build')
  assert.equal(buildPathFor({ syncPath: '/opt/src/app/' }), '/opt/src/app/build')
  assert.equal(buildPathFor({ syncPath: '~/src/app', buildPath: '/opt/out' }), '/opt/out')
  assert.equal(buildPathFor({}), '~')
})

test('stageCommandFor falls back to the built-in cmake commands', () => {
  assert.equal(stageCommandFor({ stages: {} }, 'configure'), 'cmake ..')
  assert.equal(stageCommandFor({ stages: {} }, 'build'), 'cmake --build . -j$(nproc)')
  assert.equal(stageCommandFor({ stages: {} }, 'install'), 'cmake --install .')
  assert.equal(stageCommandFor({ stages: {} }, 'test'), 'ctest')
  assert.equal(stageCommandFor({ stages: { build: 'make -j8' } }, 'build'), 'make -j8')
})

test('terminalSince returns only text after the cursor', () => {
  const session = { total: 6, output: 'abcdef' }
  assert.equal(terminalSince(session, 3), 'def')
  assert.equal(terminalSince(session, 0), 'abcdef')
})

test('terminalRawSince keeps ANSI text after a cursor and clamps trimming', () => {
  const session = { rawTotal: 10, raw: 'abcdefghij' }
  assert.equal(terminalRawSince(session, 0), 'abcdefghij')
  assert.equal(terminalRawSince(session, 7), 'hij')
  const trimmed = { rawTotal: 20, raw: 'abcdefghij' }
  assert.equal(terminalRawSince(trimmed, 0), 'abcdefghij')
  assert.equal(terminalRawSince(trimmed, 14), 'efghij')
})

test('GET /session suggests the workspace as the local source default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-build-servers-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = dir
  let handler
  const disposers = []
  const dispose = (value) => {
    if (typeof value === 'function') disposers.push(value)
    return value
  }
  apply({
    effect: (run) => dispose(run()),
    webServer: {
      register(route) {
        handler = route.handler
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1',
    },
    tools: { register: () => () => {} },
    workspaceRegistry: {
      list: () => [
        { id: 'ws_demo', path: 'D:\\workspace\\demo', sessionIds: ['session-demo'] },
      ],
    },
  })
  try {
    let body
    await handler(
      { method: 'GET', url: '/build-servers/session?session=session-demo', headers: {} },
      {
        writeHead() {},
        end(payload) {
          body = JSON.parse(payload)
        },
      },
    )
    assert.equal(body.ok, true)
    assert.equal(body.workspace, 'ws_demo')
    assert.deepEqual(body.defaults, {
      localPath: 'D:\\workspace\\demo',
      syncPath: '',
      syncExclude: '.git build node_modules .venv .dsh-plugins',
    })
  } finally {
    for (const disposer of disposers) disposer()
    process.env.DSH_PROFILE_DIR = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('a new session stays local instead of inheriting the workspace server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-build-servers-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = dir
  await writeFile(
    join(dir, 'build-servers.json'),
    JSON.stringify({
      version: 2,
      servers: [{ id: 'srv_server68', name: 'server-68', target: 'server-68', enabled: true }],
    }),
  )
  await writeFile(
    join(dir, 'build-server-bindings.json'),
    JSON.stringify({ workspaces: { ws_demo: 'srv_server68' }, sessions: {} }),
  )
  let handler
  const disposers = []
  const dispose = (value) => {
    if (typeof value === 'function') disposers.push(value)
    return value
  }
  apply({
    effect: (run) => dispose(run()),
    webServer: {
      register(route) {
        handler = route.handler
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1',
    },
    tools: { register: () => () => {} },
    workspaceRegistry: {
      list: () => [
        { id: 'ws_demo', path: 'D:\\workspace\\demo', sessionIds: ['session-demo'] },
      ],
    },
  })
  try {
    let body
    await handler(
      { method: 'GET', url: '/build-servers/session?session=session-demo', headers: {} },
      {
        writeHead() {},
        end(payload) {
          body = JSON.parse(payload)
        },
      },
    )
    assert.equal(body.ok, true)
    assert.equal(body.serverId, null)
    assert.equal(body.source, 'none')
  } finally {
    for (const disposer of disposers) disposer()
    process.env.DSH_PROFILE_DIR = previous
    await rm(dir, { recursive: true, force: true })
  }
})
