/**
 * Remote build servers — Host half.
 *
 * Owns the persistent server list, SSH probes, path detection, the
 * build → install → test pipeline, and line-mode remote shells. The browser
 * half talks to this file through one same-origin HTTP prefix route. No
 * credentials are stored here: SSH authentication stays with the user's
 * ssh-agent / key files through BatchMode.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const ROUTE = '/build-servers'
const STORE_VERSION = 2
const MAX_BODY = 256 * 1024
const STAGE_OUTPUT_LIMIT = 128 * 1024
const SNAPSHOT_OUTPUT_LIMIT = 64 * 1024
const TERMINAL_OUTPUT_LIMIT = 96 * 1024
const PROBE_TIMEOUT_MS = 20_000
const DETECT_TIMEOUT_MS = 25_000
const PROBE_CONCURRENCY = 6
const PROBE_CACHE_MS = 10_000
const MAX_TERMINALS = 4
const STAGE_KEYS = ['build', 'install', 'test']
const PIPELINE_STAGES = ['sync', ...STAGE_KEYS]
const DEFAULT_SYNC_EXCLUDES = '.git build node_modules .venv .dsh-plugins'

/** Host services this plugin cannot work without. */
export const inject = ['webServer', 'tools', 'workspaceRegistry']

export function apply(ctx) {
  const pipelines = new Map()
  const terminals = new Map()
  const probeCache = new Map()
  const sessionWorkspace = new Map()
  let nextPipelineId = 1

  const handler = async (req, res) => {
    try {
      enforceSameOrigin(ctx, req)
      const url = new URL(req.url || ROUTE, 'http://127.0.0.1')
      const sub = url.pathname.startsWith(ROUTE)
        ? url.pathname.slice(ROUTE.length) || '/'
        : url.pathname

      if (sub === '/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, version: 2 })
      }

      if (sub === '/servers' && req.method === 'GET') {
        const loaded = await readStore()
        const recent = [...pipelines.values()]
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, 20)
          .map((job) => snapshotPipeline(job, false))
        return sendJson(res, 200, {
          ok: true,
          servers: loaded.servers,
          warnings: loaded.warnings,
          file: storeFile(),
          pipelines: recent,
        })
      }

      if (sub === '/servers' && req.method === 'PUT') {
        const body = await readJson(req)
        const saved = await writeStore(body?.servers)
        if (saved.problems.length > 0) {
          return sendJson(res, 400, {
            ok: false,
            error: saved.problems[0],
            problems: saved.problems,
          })
        }
        return sendJson(res, 200, { ok: true, servers: saved.servers })
      }

      if (sub === '/probe' && req.method === 'POST') {
        const body = await readJson(req)
        const loaded = await readStore()
        const wanted = Array.isArray(body?.ids) ? new Set(body.ids) : null
        const targets = loaded.servers.filter(
          (server) => (wanted ? wanted.has(server.id) : true) && server.enabled !== false,
        )
        const results = await probeAll(targets)
        return sendJson(res, 200, { ok: true, at: Date.now(), results })
      }

      if (sub === '/detect-path' && req.method === 'POST') {
        const body = await readJson(req)
        const server = await serverForDetection(body)
        const candidates = await detectPaths(server)
        return sendJson(res, 200, { ok: true, candidates })
      }

      if (sub === '/session' && req.method === 'GET') {
        const session = url.searchParams.get('session')
        if (!isSessionId(session)) {
          return sendJson(res, 400, { ok: false, error: '缺少有效的 session 参数' })
        }
        const workspace = url.searchParams.get('workspace') || ''
        const { server, servers, workspace: key, source } = await resolveSessionServer(
          session,
          workspace,
        )
        const settings = server ? await readSettings(session) : emptySettings()
        const probe = server ? await probeCached(server, settings.repoPath) : null
        const latest = server ? latestPipeline(server.id) : null
        return sendJson(res, 200, {
          ok: true,
          session,
          workspace: key,
          source,
          serverId: server ? server.id : null,
          servers: servers.map(({ id, name, target, enabled }) => ({ id, name, target, enabled })),
          server,
          settings,
          probe,
          pipeline: latest ? snapshotPipeline(latest, false) : null,
        })
      }

      if (sub === '/session' && req.method === 'PUT') {
        const body = await readJson(req)
        const session = body?.session
        if (!isSessionId(session)) {
          return sendJson(res, 400, { ok: false, error: '缺少有效的 session 参数' })
        }
        const workspace =
          workspaceForSession(session) ||
          (typeof body?.workspace === 'string' && body.workspace.length > 0
            ? body.workspace
            : '')
        let settings = null
        if (body?.settings && typeof body.settings === 'object') {
          settings = await writeSettings(session, body.settings)
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'serverId')) {
          if (body.serverId === null || body.serverId === '') {
            await writeBinding(session, workspace, null)
          } else {
            const loaded = await readStore()
            const server = loaded.servers.find((entry) => entry.id === body.serverId)
            if (!server) return sendJson(res, 404, { ok: false, error: '未找到该编译服务器' })
            await writeBinding(session, workspace, server.id)
          }
        }
        const resolved = await resolveSessionServer(session)
        return sendJson(res, 200, {
          ok: true,
          serverId: resolved.server ? resolved.server.id : null,
          workspace: resolved.workspace,
          settings: settings || (resolved.server ? await readSettings(session) : null),
        })
      }

      if (sub === '/pipelines' && req.method === 'POST') {
        const body = await readJson(req)
        const session = body?.session
        if (!isSessionId(session)) {
          return sendJson(res, 400, { ok: false, error: '缺少有效的 session 参数' })
        }
        const { server } = await resolveSessionServer(session)
        if (!server) {
          return sendJson(res, 400, { ok: false, error: '当前会话还没有绑定编译服务器' })
        }
        const settings = await readSettings(session)
        const configured = STAGE_KEYS.filter((key) => settings.stages[key])
        if (configured.length === 0 && !settings.localPath) {
          return sendJson(res, 400, {
            ok: false,
            error: '请先在该会话的编译设置中填写本地源码路径或阶段命令',
          })
        }
        const running = [...pipelines.values()].find(
          (job) => job.serverId === server.id && job.status === 'running',
        )
        if (running) return sendJson(res, 200, { ok: true, pipeline: snapshotPipeline(running, false) })
        const job = createPipeline(server, settings, nextPipelineId++)
        pipelines.set(job.id, job)
        prunePipelines(pipelines, job.id)
        void runPipeline(job, server, settings)
        return sendJson(res, 200, { ok: true, pipeline: snapshotPipeline(job, true) })
      }

      if (sub === '/pipelines' && req.method === 'GET') {
        const jobId = url.searchParams.get('job')
        if (!jobId) return sendJson(res, 400, { ok: false, error: '缺少 job 参数' })
        const job = pipelines.get(jobId)
        if (!job) return sendJson(res, 404, { ok: false, error: '构建记录已失效' })
        return sendJson(res, 200, { ok: true, pipeline: snapshotPipeline(job, true) })
      }

      if (sub === '/pipelines/stop' && req.method === 'POST') {
        const body = await readJson(req)
        const job = pipelines.get(body?.job)
        if (!job) return sendJson(res, 404, { ok: false, error: '构建记录已失效' })
        if (job.status === 'running') {
          job.stopped = true
          try {
            job.child?.kill()
            job.upload?.kill()
          } catch {
            /* the close handler settles the stage */
          }
        }
        return sendJson(res, 200, { ok: true, pipeline: snapshotPipeline(job, true) })
      }

      if (sub === '/terminal/open' && req.method === 'POST') {
        const body = await readJson(req)
        const loaded = await readStore()
        const server = loaded.servers.find((entry) => entry.id === body?.id)
        if (!server) return sendJson(res, 404, { ok: false, error: '未找到该编译服务器' })
        for (const [id, session] of terminals) {
          if (!session.alive) terminals.delete(id)
        }
        const existing = [...terminals.values()].find(
          (entry) => entry.serverId === server.id && entry.alive,
        )
        if (existing) {
          return sendJson(res, 200, { ok: true, session: snapshotTerminal(existing), reused: true })
        }
        if (terminals.size >= MAX_TERMINALS) {
          return sendJson(res, 429, { ok: false, error: `同时最多打开 ${MAX_TERMINALS} 个远程终端` })
        }
        const session = openTerminal(server)
        terminals.set(session.id, session)
        return sendJson(res, 200, { ok: true, session: snapshotTerminal(session) })
      }

      if (sub === '/terminal' && req.method === 'GET') {
        const sessionId = url.searchParams.get('session')
        const session = sessionId ? terminals.get(sessionId) : undefined
        if (!session) return sendJson(res, 404, { ok: false, error: '终端会话已失效' })
        return sendJson(res, 200, { ok: true, session: snapshotTerminal(session) })
      }

      if (sub === '/terminal/input' && req.method === 'POST') {
        const body = await readJson(req)
        const session = terminals.get(body?.session)
        if (!session) return sendJson(res, 404, { ok: false, error: '终端会话已失效' })
        if (!session.alive) return sendJson(res, 409, { ok: false, error: '终端已退出' })
        const data = typeof body?.data === 'string' ? body.data : ''
        if (data.length > 8192) return sendJson(res, 413, { ok: false, error: '单次输入过长' })
        try {
          session.child.stdin.write(data)
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: `写入失败：${error.message}` })
        }
        return sendJson(res, 200, { ok: true })
      }

      if (sub === '/terminal/close' && req.method === 'POST') {
        const body = await readJson(req)
        const session = terminals.get(body?.session)
        if (!session) return sendJson(res, 404, { ok: false, error: '终端会话已失效' })
        try {
          session.child.kill()
        } catch {
          /* already gone */
        }
        terminals.delete(session.id)
        return sendJson(res, 200, { ok: true })
      }

      return sendJson(res, 404, { ok: false, error: `未知接口 ${req.method} ${sub}` })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      return sendJson(res, status, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler })
    return () => {
      disposeRoute()
      for (const session of terminals.values()) {
        try {
          session.child.kill()
        } catch {
          /* best effort on unload */
        }
      }
      terminals.clear()
    }
  })

  /**
   * Agent-facing surface of the same shell the panel uses. A session keeps
   * cwd/env across calls, so the model types into one live shell instead of
   * opening a new SSH connection for every command.
   */
  ctx.effect(() =>
    ctx.tools.register({
      name: 'remote_terminal',
      description:
        'Run commands in a persistent SSH login shell on a build server configured in the Build servers panel. ' +
        'One session keeps its working directory and environment across calls, so repeated commands do not reconnect. ' +
        'Sessions are shared with the panel terminal: opening the same server reuses the live shell. ' +
        'Start with action "list" to discover server ids, then "open", "send" (optionally waiting for output), ' +
        '"read" with the returned cursor for later output, and "close".',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'open', 'send', 'read', 'close'],
            description: 'Terminal operation.',
          },
          server: {
            type: 'string',
            description: 'Server id or display name, required for action "open".',
          },
          session: {
            type: 'string',
            description: 'Session id returned by "open"; required for send, read, and close.',
          },
          input: {
            type: 'string',
            description: 'Text written to the shell; a trailing newline is added when missing.',
          },
          waitMs: {
            type: 'integer',
            description: 'How long "send" waits for output, 200-8000 ms; default 900.',
          },
          cursor: {
            type: 'integer',
            description: 'Output cursor from an earlier call; "read" returns text after it.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        },
      },
      timeoutMs: 60_000,
      async execute(args) {
        const input = args && typeof args === 'object' ? args : {}
        const action = input.action

        const findSession = () => {
          const session = typeof input.session === 'string' ? terminals.get(input.session) : undefined
          if (!session) throw new Error('终端会话不存在或已关闭')
          return session
        }

        if (action === 'list') {
          const loaded = await readStore()
          return {
            servers: loaded.servers.map((server) => ({
              id: server.id,
              name: server.name,
              target: server.target,
              repoPath: server.repoPath,
              localPath: server.localPath,
              stages: server.stages,
            })),
            sessions: [...terminals.values()].map((session) => ({
              session: session.id,
              serverId: session.serverId,
              serverName: session.serverName,
              alive: session.alive,
              cursor: session.total,
            })),
          }
        }

        if (action === 'open') {
          const wanted = String(input.server || '').trim()
          if (!wanted) throw new Error('open 需要 server（id 或名称）')
          const loaded = await readStore()
          const server =
            loaded.servers.find((entry) => entry.id === wanted) ||
            loaded.servers.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase())
          if (!server) throw new Error(`未找到编译服务器：${wanted}`)
          for (const [id, session] of terminals) {
            if (!session.alive) terminals.delete(id)
          }
          const existing = [...terminals.values()].find(
            (entry) => entry.serverId === server.id && entry.alive,
          )
          if (existing) {
            return {
              session: existing.id,
              serverId: server.id,
              serverName: server.name,
              alive: true,
              reused: true,
              cursor: existing.total,
              output: existing.output,
            }
          }
          if (terminals.size >= MAX_TERMINALS) {
            throw new Error(`同时最多打开 ${MAX_TERMINALS} 个远程终端`)
          }
          const session = openTerminal(server)
          terminals.set(session.id, session)
          await new Promise((done) => setTimeout(done, 500))
          return {
            session: session.id,
            serverId: server.id,
            serverName: server.name,
            alive: session.alive,
            cursor: session.total,
            output: session.output,
          }
        }

        if (action === 'send') {
          const session = findSession()
          if (!session.alive) throw new Error('终端已退出，请重新 open')
          let data = String(input.input ?? '')
          if (!data) throw new Error('send 需要 input')
          if (!/[\r\n]$/.test(data) && !data.endsWith('\u0003')) data += '\n'
          const before = session.total
          try {
            session.child.stdin.write(data)
          } catch (error) {
            throw new Error(`写入远端终端失败：${error.message}`)
          }
          const wait = Math.min(8000, Math.max(200, Number(input.waitMs) || 900))
          await new Promise((done) => setTimeout(done, wait))
          return {
            session: session.id,
            cursor: session.total,
            alive: session.alive,
            exitCode: session.exitCode,
            output: terminalSince(session, before),
          }
        }

        if (action === 'read') {
          const session = findSession()
          const cursor = Number.isFinite(Number(input.cursor)) ? Number(input.cursor) : 0
          return {
            session: session.id,
            cursor: session.total,
            alive: session.alive,
            exitCode: session.exitCode,
            trimmed: session.trimmed,
            output: terminalSince(session, cursor),
          }
        }

        if (action === 'close') {
          const session = findSession()
          try {
            session.child.kill()
          } catch {
            /* already gone */
          }
          terminals.delete(session.id)
          return { closed: true, session: session.id }
        }

        throw new Error(`未知 action：${String(action)}`)
      },
    }),
  )

  /**
   * Build operations for the conversation's bound server, mirroring the bar's
   * buttons so the model and the user drive the same pipeline.
   */
  ctx.effect(() =>
    ctx.tools.register({
      name: 'build_server',
      description:
        'Inspect or run the build server bound to the current session (the one shown at the bottom of the conversation). ' +
        'Actions: "status" returns the binding, session build settings, live probe, and latest pipeline; "run" starts the upload/build/install/test pipeline; ' +
        '"pipeline" returns one pipeline with its output; "stop" stops the running one. Use "status" first, and run only when the user asks to build.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'run', 'pipeline', 'stop'],
            description: 'Build server operation.',
          },
          job: {
            type: 'string',
            description: 'Pipeline id for "pipeline" or "stop"; defaults to the latest pipeline of the bound server.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const session = exec && exec.agent ? exec.agent.id : ''
        if (!isSessionId(session)) throw new Error('无法确定当前对话')
        const { server } = await resolveSessionServer(session)
        if (!server) throw new Error('当前会话还没有绑定编译服务器，请先在对话底部绑定')
        const action = args && typeof args === 'object' ? args.action : ''

        if (action === 'status') {
          const settings = await readSettings(session)
          const probe = await probeCached(server, settings.repoPath)
          const latest = latestPipeline(server.id)
          return {
            session,
            server: {
              id: server.id,
              name: server.name,
              target: server.target,
            },
            settings,
            probe,
            pipeline: latest ? snapshotPipeline(latest, false) : null,
          }
        }

        if (action === 'run') {
          const settings = await readSettings(session)
          if (STAGE_KEYS.every((key) => !settings.stages[key]) && !settings.localPath) {
            throw new Error('当前会话还没有配置本地源码路径或阶段命令')
          }
          const running = [...pipelines.values()].find(
            (job) => job.serverId === server.id && job.status === 'running',
          )
          if (running) return { started: false, pipeline: snapshotPipeline(running, false) }
          const job = createPipeline(server, settings, nextPipelineId++)
          pipelines.set(job.id, job)
          prunePipelines(pipelines, job.id)
          void runPipeline(job, server, settings)
          return { started: true, pipeline: snapshotPipeline(job, false) }
        }

        if (action === 'pipeline') {
          const jobId = args && typeof args.job === 'string' ? args.job : ''
          const job = jobId ? pipelines.get(jobId) : latestPipeline(server.id)
          if (!job) throw new Error('没有找到该服务器的流水线记录')
          return { pipeline: snapshotPipeline(job, true) }
        }

        if (action === 'stop') {
          const jobId = args && typeof args.job === 'string' ? args.job : ''
          const job = jobId
            ? pipelines.get(jobId)
            : [...pipelines.values()].find(
                (entry) => entry.serverId === server.id && entry.status === 'running',
              )
          if (!job) throw new Error('没有正在运行的流水线')
          if (job.status === 'running') {
            job.stopped = true
            try {
              job.child?.kill()
              job.upload?.kill()
            } catch {
              /* settled by the close handler */
            }
          }
          return { pipeline: snapshotPipeline(job, false) }
        }

        throw new Error(`未知 action：${String(action)}`)
      },
    }),
  )

  /** Session binding wins; a new session inherits the workspace's last used server. */
  async function resolveSessionServer(session, workspaceHint) {
    const loaded = await readStore()
    const bindings = await readBindings()
    const workspace = workspaceForSession(session) || workspaceHint || ''
    const hasSession = Object.prototype.hasOwnProperty.call(bindings.sessions, session)
    const boundId = hasSession
      ? bindings.sessions[session]
      : workspace
        ? bindings.workspaces[workspace]
        : null
    const server =
      boundId && typeof boundId === 'string'
        ? loaded.servers.find((entry) => entry.id === boundId && entry.enabled !== false) || null
        : null
    return {
      server,
      servers: loaded.servers,
      workspace,
      source: hasSession ? (boundId ? 'session' : 'none') : boundId ? 'workspace' : 'none',
    }
  }

  function workspaceForSession(session) {
    try {
      const workspace = ctx.workspaceRegistry
        .list()
        .find((entry) => entry.sessionIds.includes(session))
      return workspace ? workspace.id : ''
    } catch {
      return ''
    }
  }

  async function probeCached(server, repoPath) {
    const cacheKey = `${server.id}|${repoPath || ''}`
    const cached = probeCache.get(cacheKey)
    if (cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.result
    const result = await probeServer(server, repoPath || '')
    probeCache.set(cacheKey, { at: Date.now(), result })
    return result
  }

  function latestPipeline(serverId) {
    return [...pipelines.values()]
      .filter((job) => job.serverId === serverId)
      .sort((a, b) => b.startedAt - a.startedAt)[0]
  }

  function openTerminal(server) {
    const decoder = new StringDecoder('utf8')
    const session = {
      id: `term_${randomBytes(4).toString('hex')}`,
      serverId: server.id,
      serverName: server.name,
      child: null,
      output: '',
      total: 0,
      trimmed: false,
      alive: true,
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      endedAt: null,
      transportError: '',
    }
    const child = spawn('ssh', ['-tt', ...sshArguments(server), 'bash -l'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    session.child = child
    const append = (text) => {
      if (!text) return
      const clean = sanitizeTerminal(text)
      if (!clean) return
      session.total += clean.length
      session.output += clean
      if (session.output.length > TERMINAL_OUTPUT_LIMIT) {
        session.output = session.output.slice(-TERMINAL_OUTPUT_LIMIT)
        session.trimmed = true
      }
    }
    child.stdout.on('data', (chunk) => append(decoder.write(chunk)))
    child.stderr.on('data', (chunk) => append(decoder.write(chunk)))
    child.on('error', (error) => {
      session.transportError =
        error.code === 'ENOENT' ? '未找到 ssh 客户端' : error.message || String(error)
      session.alive = false
      session.endedAt = Date.now()
      append(`\n[本地错误] ${session.transportError}\n`)
    })
    child.on('close', (code, signal) => {
      append(decoder.end())
      session.alive = false
      session.exitCode = code
      session.signal = signal
      session.endedAt = Date.now()
    })
    return session
  }

  function createPipeline(server, settings, id) {
    const stages = PIPELINE_STAGES.map((key) => {
      const command =
        key === 'sync'
          ? settings.localPath
            ? `${settings.localPath} → ${settings.repoPath}`
            : ''
          : settings.stages[key] || ''
      return {
        key,
        command,
        status: command ? 'pending' : 'skipped',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        signal: null,
        output: '',
        bytes: 0,
        truncated: false,
      }
    })
    return {
      id: `pipe_${id}`,
      serverId: server.id,
      serverName: server.name,
      repoPath: settings.repoPath,
      status: 'running',
      current: null,
      startedAt: Date.now(),
      endedAt: null,
      stopped: false,
      transportError: '',
      child: null,
      upload: null,
      stages,
    }
  }

  async function runPipeline(job, server, settings) {
    for (const stage of job.stages) {
      if (job.stopped) {
        if (stage.status === 'pending') stage.status = 'skipped'
        continue
      }
      if (!stage.command) {
        stage.status = 'skipped'
        continue
      }
      job.current = stage.key
      stage.status = 'running'
      stage.startedAt = Date.now()
      const result =
        stage.key === 'sync'
          ? await runSync(job, server, settings, stage)
          : await runStage(job, server, settings, stage)
      stage.endedAt = Date.now()
      stage.exitCode = result.code
      stage.signal = result.signal
      stage.status = job.stopped
        ? 'stopped'
        : result.error || result.timedOut
          ? 'failed'
          : result.code === 0
            ? 'succeeded'
            : 'failed'
      if (stage.status !== 'succeeded') {
        job.status = stage.status === 'stopped' ? 'stopped' : 'failed'
        break
      }
    }
    for (const stage of job.stages) {
      if (stage.status === 'pending') stage.status = 'skipped'
    }
    if (job.stopped) {
      job.status = 'stopped'
    } else if (job.status === 'running') {
      job.status = 'succeeded'
    }
    job.current = null
    job.endedAt = Date.now()
    job.child = null
  }

  function runStage(job, server, settings, stage) {
    return new Promise((resolve) => {
      const command = stageCommand(server, settings, stage.command)
      let child
      try {
        child = spawn('ssh', [...sshArguments(server), command], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        stage.output += `[本地错误] ${error.message}\n`
        stage.truncated = true
        resolve({ code: null, signal: null, error })
        return
      }
      job.child = child
      const decoder = new StringDecoder('utf8')
      let settled = false
      const append = (text) => {
        if (!text) return
        stage.output += text
        if (stage.output.length > STAGE_OUTPUT_LIMIT) {
          stage.output = stage.output.slice(-STAGE_OUTPUT_LIMIT)
          stage.truncated = true
        }
      }
      const finish = (code, signal, error) => {
        if (settled) return
        settled = true
        job.child = null
        resolve({ code, signal, error })
      }
      child.stdout.on('data', (chunk) => append(decoder.write(chunk)))
      child.stderr.on('data', (chunk) => append(decoder.write(chunk)))
      child.on('error', (error) => {
        job.transportError =
          error.code === 'ENOENT' ? '未找到 ssh 客户端' : error.message || String(error)
        append(`\n[本地错误] ${job.transportError}\n`)
        finish(null, null, error)
      })
      child.on('close', (code, signal) => {
        append(decoder.end())
        finish(code, signal, null)
      })
    })
  }

  /**
   * Upload the local source tree through a tar pipe. Two child processes mean
   * no local shell quoting; the byte counter feeds the live stage progress.
   */
  function runSync(job, server, settings, stage) {
    return new Promise((resolve) => {
      let settled = false
      let tarChild = null
      let sshChild = null
      let tarCode = null
      const append = (text) => {
        if (!text) return
        stage.output += text
        if (stage.output.length > STAGE_OUTPUT_LIMIT) {
          stage.output = stage.output.slice(-STAGE_OUTPUT_LIMIT)
          stage.truncated = true
        }
      }
      const finish = (code, signal, error) => {
        if (settled) return
        settled = true
        job.child = null
        job.upload = null
        if (tarChild && tarChild.exitCode == null) {
          try {
            tarChild.kill()
          } catch {
            /* already ended */
          }
        }
        resolve({ code, signal, error })
      }
      const start = async () => {
        let info
        try {
          info = await stat(settings.localPath)
        } catch (error) {
          append(`[本地] 无法读取本地路径 ${settings.localPath}：${error.message}\n`)
          finish(null, null, error)
          return
        }
        if (!info.isDirectory()) {
          append(`[本地] ${settings.localPath} 不是目录\n`)
          finish(null, null, new Error('本地源码路径不是目录'))
          return
        }
        const excludes = String(settings.syncExclude || DEFAULT_SYNC_EXCLUDES)
          .split(/\s+/)
          .filter(Boolean)
        const tarArgs = ['-cf', '-']
        for (const pattern of excludes) tarArgs.push('--exclude', pattern)
        tarArgs.push('-C', settings.localPath, '.')
        try {
          tarChild = spawn('tar', tarArgs, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          sshChild = spawn(
            'ssh',
            [
              ...sshArguments(server),
              `mkdir -p ${remotePath(settings.repoPath)} && tar -xf - -C ${remotePath(settings.repoPath)}`,
            ],
            { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
          )
        } catch (error) {
          append(`[本地错误] ${error.message}\n`)
          finish(null, null, error)
          return
        }
        job.child = sshChild
        job.upload = tarChild
        const tarDecoder = new StringDecoder('utf8')
        const sshDecoder = new StringDecoder('utf8')
        tarChild.stdout.on('data', (chunk) => {
          stage.bytes += chunk.length
        })
        tarChild.stdout.pipe(sshChild.stdin)
        sshChild.stdin.on('error', () => {
          /* the remote side may exit before tar finishes */
        })
        tarChild.stderr.on('data', (chunk) => append(tarDecoder.write(chunk)))
        sshChild.stderr.on('data', (chunk) => append(sshDecoder.write(chunk)))
        tarChild.on('error', (error) => {
          append(`[本地] tar: ${error.message}\n`)
          tarCode = -1
          try {
            sshChild.kill()
          } catch {
            /* already closed */
          }
        })
        tarChild.on('close', (code) => {
          tarCode = code
          if (code !== 0) {
            try {
              sshChild.kill()
            } catch {
              /* already closed */
            }
          }
        })
        sshChild.on('error', (error) => {
          append(`[本地] ssh: ${error.message}\n`)
          finish(null, null, error)
        })
        sshChild.on('close', (code, signal) => {
          if (tarCode !== null && tarCode !== 0) {
            append(`[本地] tar 退出码 ${tarCode}\n`)
            finish(code, signal, new Error(`tar 退出码 ${tarCode}`))
            return
          }
          append(`\n[同步] 已上传 ${formatBytes(stage.bytes)} 到 ${settings.repoPath}\n`)
          finish(code, signal, null)
        })
      }
      void start()
    })
  }
}

/* ---------------------------------------------------------------- probes */

async function probeAll(servers) {
  const results = new Array(servers.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < servers.length) {
      const index = cursor++
      results[index] = await probeServer(servers[index], '')
    }
  }
  const width = Math.max(1, Math.min(PROBE_CONCURRENCY, servers.length))
  await Promise.all(Array.from({ length: width }, worker))
  return results
}

async function probeServer(server, repoPath) {
  const started = Date.now()
  const run = await runSsh(server, probeCommand(repoPath), PROBE_TIMEOUT_MS)
  const latencyMs = Date.now() - started
  if (run.error || run.timedOut || run.code !== 0) {
    return {
      id: server.id,
      ok: false,
      at: Date.now(),
      latencyMs,
      error: describeFailure(run),
    }
  }
  const fields = parseKeyValues(run.stdout)
  const load = String(fields.load || '')
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value))
  const memTotalKb = toNumber(fields.memtotal)
  const memAvailableKb = toNumber(fields.memavail)
  const disk = parseDisk(fields.disk)
  const tools = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('tool_') && value) tools[key.slice(5)] = value
  }
  return {
    id: server.id,
    ok: true,
    at: Date.now(),
    latencyMs,
    hostname: fields.hostname || server.target,
    ip: fields.ip || '',
    uptimeSec: toNumber(fields.uptime),
    load,
    cpus: toNumber(fields.cpus),
    os: {
      id: fields.os_id || '',
      name: fields.os_name || fields.os_id || '',
      version: fields.os_version || '',
      kernel: fields.kernel || '',
      arch: fields.arch || '',
    },
    user: fields.user || '',
    home: fields.home || '',
    tools,
    defaultPath: fields.default_path || '',
    memTotalKb,
    memAvailableKb,
    memUsedRatio:
      memTotalKb && Number.isFinite(memAvailableKb)
        ? Math.min(1, Math.max(0, (memTotalKb - memAvailableKb) / memTotalKb))
        : null,
    disk,
    git:
      fields.branch || fields.commit
        ? {
            branch: fields.branch || '',
            commit: fields.commit || '',
            subject: fields.subject || '',
            commitTime: toNumber(fields.commit_time),
            dirty: toNumber(fields.dirty),
          }
        : null,
  }
}

/** Shell helper: POSIX, read-only, one round trip, never fails the whole probe. */
function probeCommand(repoPath) {
  const lines = [
    `printf 'hostname=%s\\n' "$(hostname 2>/dev/null)"`,
    `ipaddr=$(hostname -I 2>/dev/null | awk '{print $1}'); [ -n "$ipaddr" ] || ipaddr=$(hostname -i 2>/dev/null | awk '{print $1}'); printf 'ip=%s\\n' "$ipaddr"`,
    `printf 'kernel=%s\\n' "$(uname -r 2>/dev/null)"`,
    `printf 'arch=%s\\n' "$(uname -m 2>/dev/null)"`,
    `printf 'user=%s\\n' "$(id -un 2>/dev/null)"`,
    `printf 'home=%s\\n' "$HOME"`,
    `printf 'os_id=%s\\n' "$(sed -n 's/^ID=//p' /etc/os-release 2>/dev/null | tr -d '\\"')"`,
    `printf 'os_name=%s\\n' "$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | tr -d '\\"')"`,
    `printf 'os_version=%s\\n' "$(sed -n 's/^VERSION_ID=//p' /etc/os-release 2>/dev/null | tr -d '\\"')"`,
    `printf 'uptime=%s\\n' "$(cut -d. -f1 /proc/uptime 2>/dev/null)"`,
    `printf 'load=%s\\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"`,
    `printf 'cpus=%s\\n' "$(nproc 2>/dev/null)"`,
    `printf 'memtotal=%s\\n' "$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"`,
    `printf 'memavail=%s\\n' "$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)"`,
    `printf 'tool_git=%s\\n' "$(git --version 2>/dev/null)"`,
    `printf 'tool_cmake=%s\\n' "$(cmake --version 2>/dev/null | head -n 1)"`,
    `printf 'tool_ninja=%s\\n' "$(ninja --version 2>/dev/null)"`,
    `printf 'tool_make=%s\\n' "$(make --version 2>/dev/null | head -n 1)"`,
    `printf 'tool_gcc=%s\\n' "$(gcc --version 2>/dev/null | head -n 1)"`,
    `printf 'tool_python=%s\\n' "$(python3 --version 2>/dev/null)"`,
  ]
  if (repoPath) {
    const path = remotePath(repoPath)
    lines.push(
      `printf 'disk=%s\\n' "$(df -Pk ${path} 2>/dev/null | awk 'NR==2{print $2\",\"$3\",\"$4\",\"$5}')"`,
      `printf 'branch=%s\\n' "$(git -C ${path} rev-parse --abbrev-ref HEAD 2>/dev/null)"`,
      `printf 'commit=%s\\n' "$(git -C ${path} log -1 --format=%h 2>/dev/null)"`,
      `printf 'subject=%s\\n' "$(git -C ${path} log -1 --format=%s 2>/dev/null)"`,
      `printf 'commit_time=%s\\n' "$(git -C ${path} log -1 --format=%ct 2>/dev/null)"`,
      `printf 'dirty=%s\\n' "$(git -C ${path} status --porcelain 2>/dev/null | wc -l | tr -d ' ')"`,
    )
  } else {
    lines.push(
      `p=$(find "$HOME/NIS/src" "$HOME/src" -maxdepth 2 \\( -name CMakeLists.txt -o -name build.sh \\) 2>/dev/null | head -n 1); [ -n "$p" ] && printf 'default_path=%s\\n' "$(dirname "$p")"`,
    )
  }
  return lines.join('; ')
}

/** Candidate project roots for the path picker. */
function detectCommand() {
  return [
    `for r in "$HOME/NIS/src" "$HOME/src" "$HOME/workspace" "$HOME/projects" "$HOME"; do`,
    `[ -d "$r" ] || continue;`,
    `find "$r" -maxdepth 3 \\( -name .git -o -name CMakeLists.txt -o -name build.sh -o -name Makefile \\) -prune -printf '%h|%f\\n' 2>/dev/null;`,
    `done | head -n 80`,
  ].join(' ')
}

async function detectPaths(server) {
  const run = await runSsh(server, detectCommand(), DETECT_TIMEOUT_MS)
  if (run.error || run.timedOut || run.code !== 0) {
    throw new HttpError(502, describeFailure(run))
  }
  const groups = new Map()
  for (const line of String(run.stdout).split(/\r?\n/)) {
    const separator = line.indexOf('|')
    if (separator <= 0) continue
    const dir = line.slice(0, separator)
    const marker = line.slice(separator + 1)
    if (!groups.has(dir)) groups.set(dir, [])
    const markers = groups.get(dir)
    if (marker && !markers.includes(marker)) markers.push(marker)
  }
  return [...groups.entries()]
    .map(([path, markers]) => ({ path, markers }))
    .sort((a, b) => b.markers.length - a.markers.length || a.path.length - b.path.length)
    .slice(0, 12)
}

async function serverForDetection(body) {
  const loaded = await readStore()
  if (body?.id) {
    const found = loaded.servers.find((entry) => entry.id === body.id)
    if (!found) throw new HttpError(404, '未找到该编译服务器')
    return found
  }
  const result = normalizeServer(
    { name: 'detect', target: body?.target, port: body?.port, repoPath: body?.repoPath },
    0,
    'detect',
  )
  if (result.problems.length > 0) throw new HttpError(400, result.problems[0])
  return result.server
}

/* ------------------------------------------------------------------ build */

/** Builds run through `bash -lc` so a login-shell toolchain reaches them. */
function stageCommand(server, settings, command) {
  const body = `cd ${remotePath(settings.repoPath || '~')} && ${command}`
  return `bash -lc ${shellQuote(body)}`
}

function runSsh(server, command, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('ssh', [...sshArguments(server), command], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, error })
      return
    }
    const decoderOut = new StringDecoder('utf8')
    const decoderErr = new StringDecoder('utf8')
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: result.code ?? null,
        signal: result.signal ?? null,
        stdout,
        stderr,
        timedOut,
        error: result.error,
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* close still settles the promise */
      }
      setTimeout(() => finish({ code: null }), 1500)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += decoderOut.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += decoderErr.write(chunk)
    })
    child.on('error', (error) => finish({ error }))
    child.on('close', (code, signal) => {
      stdout += decoderOut.end()
      stderr += decoderErr.end()
      finish({ code, signal })
    })
  })
}

function describeFailure(run) {
  if (run.error) {
    return run.error.code === 'ENOENT' ? '未找到 ssh 客户端' : run.error.message || String(run.error)
  }
  if (run.timedOut) return 'SSH 操作超时'
  const detail = String(run.stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ')
  return detail || `SSH 退出码 ${run.code ?? '未知'}`
}

function sshArguments(server) {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', 'LogLevel=ERROR']
  if (server.port) args.push('-p', String(server.port))
  args.push(server.target)
  return args
}

/* ---------------------------------------------------------------- storage */

function storeFile() {
  const dir = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh')
  return join(dir, 'build-servers.json')
}

function isSessionId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\r\n\0]/.test(value)
  )
}

function bindingsFile() {
  return join(dirname(storeFile()), 'build-server-bindings.json')
}

async function readBindings() {
  try {
    const raw = await readFile(bindingsFile(), 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { workspaces: {}, sessions: {} }
    }
    const workspaces =
      data.workspaces && typeof data.workspaces === 'object' && !Array.isArray(data.workspaces)
        ? { ...data.workspaces }
        : {}
    const sessions =
      data.sessions && typeof data.sessions === 'object' && !Array.isArray(data.sessions)
        ? { ...data.sessions }
        : {}
    for (const [key, value] of Object.entries(data)) {
      if (key === 'workspaces' || key === 'sessions') continue
      if (typeof value === 'string') workspaces[key] = value
    }
    return { workspaces, sessions }
  } catch {
    return { workspaces: {}, sessions: {} }
  }
}

async function writeBinding(session, workspace, serverId) {
  const file = bindingsFile()
  const all = await readBindings()
  if (serverId === null) {
    all.sessions[session] = null
  } else {
    all.sessions[session] = serverId
    if (workspace) all.workspaces[workspace] = serverId
  }
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

function settingsFile() {
  return join(dirname(storeFile()), 'build-server-settings.json')
}

function emptySettings() {
  return { repoPath: '', localPath: '', syncExclude: '', stages: { build: '', install: '', test: '' } }
}

async function readAllSettings() {
  try {
    const raw = await readFile(settingsFile(), 'utf8')
    const data = JSON.parse(raw)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

async function readSettings(session) {
  const all = await readAllSettings()
  const normalized = normalizeSettings(all[session] || {})
  return normalized.settings
}

async function writeSettings(session, input) {
  const normalized = normalizeSettings(input || {})
  if (normalized.problems.length > 0) {
    throw new HttpError(400, normalized.problems[0])
  }
  const file = settingsFile()
  const all = await readAllSettings()
  all[session] = normalized.settings
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
  return normalized.settings
}

async function readStore() {
  const file = storeFile()
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { servers: [], warnings: [] }
    throw error
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`
    await rename(file, backup).catch(() => {})
    return {
      servers: [],
      warnings: [`配置文件无法解析，已备份到 ${backup}，当前列表为空。`],
    }
  }
  const servers = []
  const warnings = []
  const list = Array.isArray(data?.servers) ? data.servers : []
  list.forEach((entry, index) => {
    const result = normalizeServer(entry, index, entry?.id)
    if (result.problems.length > 0) {
      warnings.push(result.problems[0])
      return
    }
    servers.push(result.server)
  })
  return { servers, warnings }
}

async function writeStore(input) {
  if (!Array.isArray(input)) {
    return { servers: [], problems: ['servers 必须是数组'] }
  }
  if (input.length > 50) {
    return { servers: [], problems: ['最多只能配置 50 台编译服务器'] }
  }
  const servers = []
  const problems = []
  const seen = new Set()
  input.forEach((entry, index) => {
    const result = normalizeServer(entry, index, entry?.id)
    if (result.problems.length > 0) {
      problems.push(...result.problems)
      return
    }
    if (seen.has(result.server.id)) {
      problems.push(`servers[${index}] 的 id 重复`)
      return
    }
    seen.add(result.server.id)
    servers.push(result.server)
  })
  if (problems.length > 0) return { servers, problems }

  const file = storeFile()
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const payload = JSON.stringify({ version: STORE_VERSION, servers }, null, 2)
  await writeFile(temporary, `${payload}\n`, 'utf8')
  await rename(temporary, file)
  return { servers, problems: [] }
}

function normalizeServer(input, index, existingId) {
  const problems = []
  const label = `servers[${index}]`
  if (!input || typeof input !== 'object') return { server: null, problems: [`${label} 不是对象`] }

  const name = text(input.name, 80)
  if (!name) problems.push(`${label}.name 不能为空`)

  const target = text(input.target, 200)
  if (!target) problems.push(`${label}.target 不能为空`)
  else if (target.startsWith('-') || !/^[A-Za-z0-9_.:@\-[\]]+$/.test(target)) {
    problems.push(`${label}.target 只能包含主机名、SSH 别名或 user@host`)
  }

  let port = null
  if (input.port !== '' && input.port !== null && input.port !== undefined) {
    port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`${label}.port 必须是 1-65535 的整数`)
      port = null
    }
  }

  const id =
    typeof existingId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(existingId)
      ? existingId
      : `srv_${randomBytes(4).toString('hex')}`

  return {
    server: {
      id,
      name,
      target,
      port,
      enabled: input.enabled !== false,
    },
    problems,
  }
}

/** Build paths and commands belong to one session, not to the server entry. */
function normalizeSettings(input) {
  const problems = []
  const repoPath = text(input?.repoPath, 512)
  if (repoPath && /[\r\n\0]/.test(repoPath)) {
    problems.push('repoPath 不能包含换行或空字符')
  }
  const localPath = text(input?.localPath, 512)
  if (localPath && /[\r\n\0]/.test(localPath)) {
    problems.push('localPath 不能包含换行或空字符')
  }
  if (localPath && !repoPath) {
    problems.push('配置本地源码路径时必须填写远端构建路径')
  }
  const syncExclude = text(input?.syncExclude, 500)
  const rawStages =
    input?.stages && typeof input.stages === 'object' && !Array.isArray(input.stages)
      ? input.stages
      : {}
  const stages = {
    build: text(rawStages.build, 2000),
    install: text(rawStages.install, 2000),
    test: text(rawStages.test, 2000),
  }
  for (const key of STAGE_KEYS) {
    if (stages[key].includes('\0')) problems.push(`stages.${key} 包含空字符`)
  }
  return {
    settings: { repoPath, localPath, syncExclude, stages },
    problems,
  }
}

function text(value, max) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/* ------------------------------------------------------------------- http */

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function enforceSameOrigin(ctx, req) {
  if (req.method === 'GET') return
  if (req.headers['x-build-servers'] !== '1') {
    throw new HttpError(403, '缺少请求标记，已拒绝该请求')
  }
  const origin = req.headers.origin
  if (!origin) return
  let allowed
  try {
    allowed = ctx.webServer.getOrigin()
  } catch {
    throw new HttpError(503, 'Web 服务尚未就绪')
  }
  if (origin !== allowed) throw new HttpError(403, '已拒绝跨源请求')
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, '请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/* --------------------------------------------------------------- helpers */

function snapshotPipeline(job, withOutput) {
  return {
    id: job.id,
    serverId: job.serverId,
    serverName: job.serverName,
    repoPath: job.repoPath,
    status: job.status,
    current: job.current,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    transportError: job.transportError,
    stages: job.stages.map((stage) => ({
      key: stage.key,
      command: stage.command,
      status: stage.status,
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
      exitCode: stage.exitCode,
      signal: stage.signal,
      bytes: stage.bytes,
      truncated: stage.truncated,
      output: withOutput
        ? stage.output.length > SNAPSHOT_OUTPUT_LIMIT
          ? `…（前 ${stage.output.length - SNAPSHOT_OUTPUT_LIMIT} 字符已省略）\n${stage.output.slice(-SNAPSHOT_OUTPUT_LIMIT)}`
          : stage.output
        : '',
    })),
  }
}

function snapshotTerminal(session) {
  return {
    id: session.id,
    serverId: session.serverId,
    serverName: session.serverName,
    output: session.output,
    cursor: session.total,
    trimmed: session.trimmed,
    alive: session.alive,
    exitCode: session.exitCode,
    signal: session.signal,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    transportError: session.transportError,
  }
}

/** Keep a short in-memory history; the store owns only configuration. */
function prunePipelines(pipelines, keepId) {
  const settled = [...pipelines.values()]
    .filter((job) => job.status !== 'running' && job.id !== keepId)
    .sort((a, b) => b.startedAt - a.startedAt)
  for (const job of settled.slice(30)) pipelines.delete(job.id)
}

function parseKeyValues(stdout) {
  const fields = {}
  for (const line of String(stdout).split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) fields[line.slice(0, index)] = line.slice(index + 1).trim()
  }
  return fields
}

function parseDisk(value) {
  if (!value) return null
  const parts = String(value).split(',')
  if (parts.length < 4) return null
  const totalKb = toNumber(parts[0])
  const usedKb = toNumber(parts[1])
  const availableKb = toNumber(parts[2])
  const percent = Number.parseFloat(String(parts[3]).replace('%', ''))
  if (!totalKb) return null
  return {
    totalKb,
    usedKb,
    availableKb,
    percent: Number.isFinite(percent) ? percent : Math.round((usedKb / totalKb) * 100),
  }
}

function toNumber(value) {
  const number = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(number) ? number : null
}

function remotePath(path) {
  if (path === '~') return '"$HOME"'
  if (path.startsWith('~/')) return `"$HOME"/${shellQuote(path.slice(2))}`
  return shellQuote(path)
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/** Text received after a cursor, clamped to what the trimmed buffer still holds. */
function terminalSince(session, cursor) {
  const value = Number(cursor)
  const from = Number.isFinite(value) && value > 0 ? value : 0
  const start = Math.max(0, from - (session.total - session.output.length))
  return session.output.slice(start)
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** Drop ANSI control sequences and carriage-return redraws for a plain-text view. */
function sanitizeTerminal(value) {
  return String(value)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** Pure helpers exposed for the Node test suite; the Loader ignores this export. */
export const __test = {
  formatBytes,
  normalizeServer,
  normalizeSettings,
  parseDisk,
  parseKeyValues,
  remotePath,
  sanitizeTerminal,
  shellQuote,
  terminalSince,
}
