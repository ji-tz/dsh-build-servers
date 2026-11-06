window.__ModuleLoader__.load({
  id: '@local/build-servers',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'build-servers'
    const PANEL_ID = 'build-servers'
    const REFRESH_MS = 30_000
    const PIPELINE_POLL_MS = 1_200
    const TERMINAL_POLL_MS = 800
    const STAGE_KEYS = ['sync', 'build', 'install', 'test']
    const COMMAND_STAGES = ['build', 'install', 'test']

    /** One global dialog host keeps the picker alive after the sidebar menu closes. */
    const statusPopStore = {
      sessionId: null,
      left: 0,
      bottom: 0,
      listeners: new Set(),
      show(sessionId, left, bottom) {
        this.sessionId = sessionId
        this.left = left
        this.bottom = bottom
        for (const listener of this.listeners) listener()
      },
      hide() {
        this.sessionId = null
        for (const listener of this.listeners) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    }

    const bindDialogStore = {
      sessionId: null,
      autoTerminal: false,
      version: 0,
      listeners: new Set(),
      open(sessionId, autoTerminal = false) {
        this.sessionId = sessionId
        this.autoTerminal = Boolean(autoTerminal)
        this.version += 1
        for (const listener of this.listeners) listener()
      },
      close() {
        this.sessionId = null
        this.autoTerminal = false
        this.version += 1
        for (const listener of this.listeners) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    }

    const EN = {
      'nav.label': 'Build servers',
      'panel.title': 'Remote build servers',
      'panel.subtitle': 'Configure build server network endpoints only. Build paths and commands live in each session\'s compile settings.',
      'panel.store': 'Configuration file',
      'settings.title': 'Session compile settings',
      'settings.hint': 'These paths and commands belong to this session only.',
      'bar.noServer': 'No build server bound',
      'bar.unbound': 'Not bound',
      'bar.details': 'View details',
      'bar.slow': 'High latency',
      'bar.select': 'Build server',
      'bar.unconfigured': 'No build configured',
      'actions.refresh': 'Refresh all',
      'actions.add': 'Add server',
      'actions.cancel': 'Cancel',
      'actions.save': 'Save',
      'actions.edit': 'Edit',
      'actions.delete': 'Delete',
      'actions.probe': 'Probe',
      'actions.run': 'Run pipeline',
      'actions.stop': 'Stop',
      'actions.logs': 'Logs',
      'actions.terminal': 'Terminal',
      'actions.newTerminal': 'New terminal',
      'actions.configure': 'Configure',
      'actions.more': 'More',
      'actions.bindServer': 'Bind remote build server',
      'actions.unbind': 'Unbind',
      'actions.settings': 'Compile settings',
      'actions.hideTerminal': 'Hide terminal',
      'actions.buildServerMenu': 'Build server…',
      'actions.buildTerminal': 'Build server terminal',
      'dialog.title': 'Build server',
      'dialog.current': 'Current',
      'dialog.bound': 'Bound to {name}',
      'dialog.unbound': 'No server bound',
      'dialog.noServers': 'No servers configured yet.',
      'dialog.bind': 'Bind',
      'actions.buildNow': 'Build',
      'actions.hideLogs': 'Hide logs',
      'actions.close': 'Close',
      'actions.send': 'Send',
      'actions.ctrlC': 'Ctrl-C',
      'actions.reopen': 'Reopen',
      'actions.detect': 'Detect path',
      'actions.usePath': 'Use this path',
      'summary.online': '{online} of {total} online',
      'summary.updated': 'Probed {time}',
      'summary.never': 'Not probed yet',
      'summary.auto': 'Auto refresh every 30s',
      'summary.disabled': '{count} disabled',
      'status.online': 'Online',
      'status.offline': 'Offline',
      'status.probing': 'Probing',
      'status.unknown': 'Unknown',
      'status.disabled': 'Disabled',
      'status.pending': 'Waiting',
      'status.running': 'Running',
      'status.succeeded': 'Passed',
      'status.failed': 'Failed',
      'status.skipped': 'Skipped',
      'status.stopped': 'Stopped',
      'status.idle': 'Idle',
      'card.load': 'Load 1/5/15',
      'card.status': 'Status',
      'card.cpus': '{count} cores',
      'card.memory': 'Memory',
      'card.disk': 'Disk',
      'card.uptime': 'Uptime',
      'card.git': 'Repository',
      'card.noGit': 'No Git repository at this path',
      'card.changes': '{count} changed',
      'card.clean': 'Clean worktree',
      'card.noBuild': 'No pipeline in this session',
      'card.notProbed': 'Press Probe to read this machine.',
      'card.disabledHint': 'Disabled servers are skipped by auto refresh.',
      'card.detectedPath': 'Suggested path from probe:',
      'card.pipeline': 'Pipeline',
      'card.notConfigured': 'Not configured',
      'card.terminalHint': 'Line-mode shell: cd and environment persist for this session.',
      'pipeline.confirmTitle': 'Run pipeline on {name}?',
      'pipeline.confirmBody': 'A configured local path is uploaded first; then build, install, and test run in order and stop at the first failure.',
      'pipeline.confirmRun': 'Start pipeline',
      'pipeline.stopTitle': 'Stop pipeline on {name}?',
      'pipeline.stopBody': 'Closing the SSH session ends the current stage; the remote process usually receives a hangup.',
      'pipeline.stopRun': 'Stop pipeline',
      'pipeline.noStages': 'Configure at least one stage command first.',
      'pipeline.stage': 'Stage',
      'pipeline.logsTitle': '{name} · pipeline logs',
      'pipeline.logsEmpty': 'No output yet.',
      'pipeline.running': 'Running {stage}…',
      'pipeline.failedAt': 'Failed at {stage}.',
      'pipeline.allPassed': 'All stages passed.',
      'pipeline.duration': '{duration}',
      'stage.build': 'Build',
      'stage.install': 'Install',
      'stage.test': 'Test',
      'stage.sync': 'Configure',
      'stage.uploaded': 'uploaded {size}',
      'terminal.title': '{name} · remote terminal',
      'terminal.hint': 'Commands run in one remote bash login shell; the working directory persists until you close it.',
      'terminal.placeholder': 'Type a command and press Enter',
      'terminal.connecting': 'Opening shell…',
      'terminal.connected': 'Connected',
      'terminal.exited': 'Shell exited (code {code}).',
      'terminal.outputEmpty': 'Connected. Type a command below.',
      'terminal.trimmed': 'Earlier output was trimmed.',
      'empty.title': 'No build servers yet',
      'empty.body': 'Add an SSH target such as “build-host” or “user@10.0.0.8”. The panel detects the OS, project path, and toolchain with read-only commands.',
      'empty.action': 'Add your first server',
      'editor.addTitle': 'Add build server',
      'editor.editTitle': 'Edit build server',
      'editor.name': 'Display name',
      'editor.nameHint': 'Shown on the card, for example “RedHat 8 build”.',
      'editor.target': 'SSH target',
      'editor.targetHint': 'A host, an ssh config alias, or user@host. Keys and aliases come from your SSH config.',
      'editor.port': 'Port',
      'editor.portHint': 'Optional; defaults to 22 or your SSH config.',
      'editor.localPath': 'Local source path',
      'editor.localPathHint': 'Folder on this machine uploaded before building; leave empty to skip the upload stage.',
      'editor.syncExclude': 'Upload excludes',
      'editor.syncExcludeHint': 'Space-separated tar patterns; default .git build node_modules .venv .dsh-plugins.',
      'editor.repoRequired': 'A remote build path is required when uploading local source.',
      'editor.repoPath': 'Build path',
      'editor.repoPathHint': 'Remote repository or source root, for example ~/src/myproject. Leave empty to detect one.',
      'editor.detectHint': 'Reads project markers under the home directory; nothing is changed remotely.',
      'editor.detectEmpty': 'No project markers found; type a path manually.',
      'editor.detectFailed': 'Detection failed: {message}',
      'editor.stages': 'Pipeline commands',
      'editor.stagesHint': 'The upload stage copies local source into the build path; empty stages are skipped. Commands run from the build path through bash -lc.',
      'editor.buildCommand': 'Build command',
      'editor.installCommand': 'Install command',
      'editor.testCommand': 'Test command',
      'editor.buildHint': 'For example cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug && cmake --build build',
      'editor.installHint': 'For example cmake --install build',
      'editor.testHint': 'For example ctest --test-dir build --output-on-failure',
      'editor.enabled': 'Include in auto refresh',
      'editor.required': 'Display name and SSH target are required.',
      'editor.saveFailed': 'Could not save: {message}',
      'delete.title': 'Delete {name}?',
      'delete.body': 'Only the configuration entry is removed; nothing on the remote machine changes.',
      'delete.confirm': 'Delete',
      'notice.saved': 'Server configuration saved.',
      'notice.deleted': 'Server configuration removed.',
      'notice.stopped': 'Stop requested.',
      'notice.pathApplied': 'Build path saved; probing again.',
      'error.dismiss': 'Dismiss',
      'loading': 'Loading build servers…',
    }

    const ZH = {
      'nav.label': '编译服务器',
      'panel.title': '远端编译服务器',
      'panel.subtitle': '这里只配置编译服务器的名称、SSH 目标和端口；构建路径、上传目录和命令放在各会话的「编译设置」中。',
      'panel.store': '配置文件',
      'settings.title': '会话编译设置',
      'settings.hint': '这些路径和命令只属于当前会话。',
      'bar.noServer': '未绑定编译服务器',
      'bar.unbound': '未绑定编译服务器',
      'bar.details': '查看详情',
      'bar.slow': '延迟过高',
      'bar.select': '编译服务器',
      'bar.unconfigured': '未配置构建',
      'actions.refresh': '全部刷新',
      'actions.add': '添加服务器',
      'actions.cancel': '取消',
      'actions.save': '保存',
      'actions.edit': '编辑',
      'actions.delete': '删除',
      'actions.probe': '探测',
      'actions.run': '启动流水线',
      'actions.stop': '停止',
      'actions.logs': '日志',
      'actions.terminal': '终端',
      'actions.newTerminal': '新建终端',
      'actions.configure': '配置',
      'actions.more': '更多',
      'actions.bindServer': '绑定远程编译服务器',
      'actions.unbind': '解绑',
      'actions.settings': '编译设置',
      'actions.hideTerminal': '收起终端',
      'actions.buildServerMenu': '编译服务器…',
      'actions.buildTerminal': '编译服务器终端',
      'dialog.title': '编译服务器',
      'dialog.current': '当前',
      'dialog.bound': '已绑定 {name}',
      'dialog.unbound': '未绑定',
      'dialog.noServers': '还没有配置服务器。',
      'dialog.bind': '绑定',
      'actions.buildNow': '构建',
      'actions.hideLogs': '收起日志',
      'actions.close': '关闭',
      'actions.send': '发送',
      'actions.ctrlC': 'Ctrl-C',
      'actions.reopen': '重新打开',
      'actions.detect': '检测路径',
      'actions.usePath': '使用该路径',
      'summary.online': '{online} / {total} 在线',
      'summary.updated': '探测于 {time}',
      'summary.never': '尚未探测',
      'summary.auto': '每 30 秒自动刷新',
      'summary.disabled': '{count} 台已停用',
      'status.online': '在线',
      'status.offline': '离线',
      'status.probing': '探测中',
      'status.unknown': '未探测',
      'status.disabled': '已停用',
      'status.pending': '等待',
      'status.running': '进行中',
      'status.succeeded': '通过',
      'status.failed': '失败',
      'status.skipped': '跳过',
      'status.stopped': '已停止',
      'status.idle': '未运行',
      'card.load': '负载 1/5/15',
      'card.status': '状态',
      'card.cpus': '{count} 核',
      'card.memory': '内存',
      'card.disk': '磁盘',
      'card.uptime': '运行时长',
      'card.git': '代码仓库',
      'card.noGit': '该路径下没有 Git 仓库',
      'card.changes': '{count} 处变更',
      'card.clean': '工作区干净',
      'card.noBuild': '本次会话尚未运行流水线',
      'card.notProbed': '点击「探测」读取这台机器。',
      'card.disabledHint': '已停用的服务器不会参与自动刷新。',
      'card.detectedPath': '探测到建议路径：',
      'card.pipeline': '流水线',
      'card.notConfigured': '未配置',
      'card.terminalHint': '行模式 shell：cd 和环境变量在本次会话内保持。',
      'pipeline.confirmTitle': '在 {name} 上执行流水线？',
      'pipeline.confirmBody': '配置了本地源码路径时先上传源码，然后按顺序执行构建/安装/测试；遇到第一个失败即停止。',
      'pipeline.confirmRun': '开始执行',
      'pipeline.stopTitle': '停止 {name} 上的流水线？',
      'pipeline.stopBody': '关闭 SSH 会话会结束当前阶段；远端进程通常会收到挂断信号。',
      'pipeline.stopRun': '停止流水线',
      'pipeline.noStages': '请先配置至少一个阶段命令。',
      'pipeline.stage': '阶段',
      'pipeline.logsTitle': '{name} · 流水线日志',
      'pipeline.logsEmpty': '暂无输出。',
      'pipeline.running': '正在执行 {stage}…',
      'pipeline.failedAt': '在 {stage} 阶段失败。',
      'pipeline.allPassed': '所有阶段通过。',
      'pipeline.duration': '{duration}',
      'stage.build': '构建',
      'stage.install': '安装',
      'stage.test': '测试',
      'stage.sync': '配置',
      'stage.uploaded': '已上传 {size}',
      'terminal.title': '{name} · 远程终端',
      'terminal.hint': '命令在一个远端 bash 登录 shell 中执行；工作目录和环境在关闭前一直保持。',
      'terminal.placeholder': '输入命令后按 Enter',
      'terminal.connecting': '正在打开 shell…',
      'terminal.connected': '已连接',
      'terminal.exited': 'Shell 已退出（退出码 {code}）。',
      'terminal.outputEmpty': '已连接。在下方输入命令。',
      'terminal.trimmed': '较早的输出已被截断。',
      'empty.title': '还没有编译服务器',
      'empty.body': '添加 SSH 目标，例如「build-host」或「user@10.0.0.8」。面板会用只读命令识别系统、工程路径和工具链。',
      'empty.action': '添加第一台服务器',
      'editor.addTitle': '添加编译服务器',
      'editor.editTitle': '编辑编译服务器',
      'editor.name': '显示名称',
      'editor.nameHint': '显示在卡片上，例如「RedHat 8 编译机」。',
      'editor.target': 'SSH 目标',
      'editor.targetHint': '主机名、ssh 配置别名或 user@host；密钥和别名来自本机 SSH 配置。',
      'editor.port': '端口',
      'editor.portHint': '可留空，默认 22 或 SSH 配置中的端口。',
      'editor.localPath': '本地源码路径',
      'editor.localPathHint': '构建前从本机上传的目录；留空则跳过上传阶段。',
      'editor.syncExclude': '上传排除',
      'editor.syncExcludeHint': '空格分隔的 tar 排除模式，默认 .git build node_modules .venv .dsh-plugins。',
      'editor.repoRequired': '配置本地源码路径时必须填写远端构建路径。',
      'editor.repoPath': '构建路径',
      'editor.repoPathHint': '远端仓库或源码根目录，例如 ~/src/myproject；留空则自动检测。',
      'editor.detectHint': '只读扫描主目录下的工程标记，不改动远端文件。',
      'editor.detectEmpty': '没有找到工程标记，请手动填写路径。',
      'editor.detectFailed': '路径检测失败：{message}',
      'editor.stages': '流水线命令',
      'editor.stagesHint': '上传阶段把本地源码同步到构建路径；留空的阶段会被跳过。命令在该路径下通过 bash -lc 执行。',
      'editor.buildCommand': '构建命令',
      'editor.installCommand': '安装命令',
      'editor.testCommand': '测试命令',
      'editor.buildHint': '例如 cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug && cmake --build build',
      'editor.installHint': '例如 cmake --install build',
      'editor.testHint': '例如 ctest --test-dir build --output-on-failure',
      'editor.enabled': '参与自动刷新',
      'editor.required': '显示名称和 SSH 目标不能为空。',
      'editor.saveFailed': '保存失败：{message}',
      'delete.title': '删除 {name}？',
      'delete.body': '只删除这条配置，不会改动远端机器上的任何内容。',
      'delete.confirm': '删除',
      'notice.saved': '服务器配置已保存。',
      'notice.deleted': '服务器配置已删除。',
      'notice.stopped': '已请求停止。',
      'notice.pathApplied': '构建路径已保存，正在重新探测。',
      'error.dismiss': '关闭',
      'loading': '正在加载编译服务器…',
    }

    const CSS = `
      .bsv-root{height:100%;min-height:0;overflow:auto;box-sizing:border-box;padding:26px 30px 44px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
      .bsv-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px}
      .bsv-title{margin:0;font-size:19px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
      .bsv-subtitle{margin:5px 0 0;max-width:72ch;color:var(--dsw-alias-label-secondary);font-size:12.5px}
      .bsv-actions{display:flex;gap:8px;flex-wrap:wrap}
      .bsv-btn{font:inherit;font-size:12.5px;line-height:1;padding:7px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
      .bsv-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
      .bsv-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .bsv-btn:disabled{opacity:.45;cursor:default}
      .bsv-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}
      .bsv-btn-primary:hover:not(:disabled){filter:brightness(1.08)}
      .bsv-btn-danger{color:var(--dsw-alias-state-error-primary)}
      .bsv-btn-quiet{border-color:transparent;padding:5px 8px;color:var(--dsw-alias-label-secondary)}
      .bsv-btn-quiet:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
      .bsv-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}
      .bsv-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
      .bsv-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}
      .bsv-sep{width:1px;height:12px;background:var(--dsw-alias-border-l1)}
      .bsv-banner{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;margin:0 0 14px;padding:9px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12.5px}
      .bsv-banner-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
      .bsv-banner-notice{color:var(--dsw-alias-label-secondary)}
      .bsv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:14px;align-items:start}
      .bsv-card{display:flex;flex-direction:column;gap:12px;min-width:0;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
      .bsv-card[data-state="offline"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l1))}
      .bsv-card-head{display:flex;align-items:flex-start;gap:10px;min-width:0}
      .bsv-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--dsw-alias-state-idle-primary)}
      .bsv-card[data-state="online"] .bsv-dot{background:var(--dsw-alias-state-success-primary)}
      .bsv-card[data-state="offline"] .bsv-dot{background:var(--dsw-alias-state-error-primary)}
      .bsv-card[data-state="probing"] .bsv-dot{background:var(--dsw-alias-brand-primary);animation:bsv-pulse 1.1s ease-in-out infinite}
      @keyframes bsv-pulse{0%,100%{opacity:.35}50%{opacity:1}}
      @media (prefers-reduced-motion: reduce){.bsv-card[data-state="probing"] .bsv-dot{animation:none}}
      .bsv-card-title{flex:1;min-width:0}
      .bsv-name{font-size:14px;font-weight:600;display:flex;align-items:center;gap:7px;min-width:0}
      .bsv-name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-target{margin-top:1px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-ip{color:var(--dsw-alias-label-primary)}
      .bsv-tag{flex:none;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:500;line-height:1.5}
      .bsv-tag-warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,transparent)}
      .bsv-tag-error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent)}
      .bsv-card-actions{display:flex;gap:2px;flex:none}
      .bsv-os{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11.5px;min-height:17px}
      .bsv-os-name{color:var(--dsw-alias-label-primary);font-weight:600}
      .bsv-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 16px}
      .bsv-metric{min-width:0}
      .bsv-metric-label{color:var(--dsw-alias-label-secondary);font-size:11px;letter-spacing:.02em;display:flex;justify-content:space-between;gap:8px}
      .bsv-metric-value{margin-top:2px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .bsv-meter{height:4px;margin-top:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
      .bsv-meter-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
      .bsv-meter-fill[data-level="warn"]{background:var(--dsw-alias-state-warn-primary)}
      .bsv-meter-fill[data-level="error"]{background:var(--dsw-alias-state-error-primary)}
      .bsv-repo{display:flex;align-items:center;gap:8px;min-width:0;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1)}
      .bsv-repo-path{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}
      .bsv-git-branch{flex:none;font-weight:600;font-size:12px;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-git-commit{flex:none;color:var(--dsw-alias-label-secondary);font-size:11.5px}
      .bsv-git-subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11.5px}
      .bsv-suggest{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .bsv-offline{padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word}
      .bsv-muted{color:var(--dsw-alias-label-secondary)}
      .bsv-pipeline{display:flex;flex-direction:column;gap:8px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1)}
      .bsv-pipeline-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .bsv-pipeline-label{color:var(--dsw-alias-label-secondary);font-size:11px;letter-spacing:.02em}
      .bsv-stages{display:flex;gap:6px;flex-wrap:wrap}
      .bsv-stage{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:11.5px;line-height:1.5}
      .bsv-stage-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
      .bsv-stage[data-status="running"] .bsv-stage-dot{background:var(--dsw-alias-brand-primary);animation:bsv-pulse 1.1s ease-in-out infinite}
      .bsv-stage[data-status="succeeded"] .bsv-stage-dot{background:var(--dsw-alias-state-success-primary)}
      .bsv-stage[data-status="failed"] .bsv-stage-dot{background:var(--dsw-alias-state-error-primary)}
      .bsv-stage[data-status="stopped"] .bsv-stage-dot{background:var(--dsw-alias-state-warn-primary)}
      .bsv-stage-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}
      .bsv-spacer{flex:1}
      .bsv-build{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .bsv-build-status{font-size:11.5px;font-weight:600}
      .bsv-build-status[data-status="running"]{color:var(--dsw-alias-brand-primary)}
      .bsv-build-status[data-status="succeeded"]{color:var(--dsw-alias-state-success-primary)}
      .bsv-build-status[data-status="failed"]{color:var(--dsw-alias-state-error-primary)}
      .bsv-build-status[data-status="stopped"]{color:var(--dsw-alias-state-warn-primary)}
      .bsv-output{margin:0;padding:10px 12px;max-height:220px;overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
      .bsv-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:56px 24px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px}
      .bsv-empty-title{margin:0;font-size:15px;font-weight:600}
      .bsv-empty-body{margin:0;max-width:58ch;color:var(--dsw-alias-label-secondary);font-size:12.5px}
      .bsv-empty-icon{color:var(--dsw-alias-label-secondary);opacity:.8}
      .bsv-foot{margin:20px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px;word-break:break-all}
      .bsv-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
      .bsv-modal{width:min(600px,100%);max-height:calc(100vh - 48px);overflow:auto;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 48px rgba(0,0,0,.22)}
      .bsv-modal-wide{width:min(920px,100%);display:flex;flex-direction:column;overflow:hidden}
      .bsv-inline{position:static;display:block;padding:0;margin:0 0 16px;background:transparent;z-index:auto}
      .bsv-inline>.bsv-modal{width:auto;max-height:none;box-shadow:none;background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);padding:16px}
      .bsv-menu-item{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
      .bsv-menu-item:hover,.bsv-menu-item[data-highlighted]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent)}
      .bsv-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;opacity:.9}
      .bsv-menu-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .bsv-server-list{display:flex;flex-direction:column;gap:6px;margin:10px 0}
      .bsv-server-option{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
      .bsv-server-option[data-current="true"]{border-color:var(--dsw-alias-brand-primary)}
      .bsv-server-option:hover{border-color:var(--dsw-alias-brand-primary)}
      .bsv-modal-title{margin:0 0 6px;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .bsv-modal-body{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
      .bsv-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}
      .bsv-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
      .bsv-field-label{font-size:12px;font-weight:600}
      .bsv-field-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .bsv-input{font:inherit;font-size:12.5px;min-width:0;padding:7px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .bsv-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px;border-color:transparent}
      .bsv-input-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
      .bsv-textarea{resize:vertical;min-height:56px}
      .bsv-row{display:flex;gap:12px;align-items:flex-start}
      .bsv-row>.bsv-field{flex:1}
      .bsv-row>.bsv-field-narrow{flex:0 0 110px}
      .bsv-form-error{margin:0 0 12px;color:var(--dsw-alias-state-error-primary);font-size:12px}
      .bsv-command{margin:0 0 10px;padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
      .bsv-command-label{color:var(--dsw-alias-label-secondary);font-size:11px;margin:0 0 4px}
      .bsv-detect-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .bsv-candidates{display:flex;flex-direction:column;gap:4px;margin:8px 0 0;padding:0;list-style:none}
      .bsv-candidate{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
      .bsv-candidate:hover{border-color:var(--dsw-alias-brand-primary)}
      .bsv-candidate-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1);margin:4px 0 12px;flex-wrap:wrap}
      .bsv-tab{font:inherit;font-size:12.5px;padding:7px 10px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
      .bsv-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
      .bsv-log{margin:0;padding:12px;height:min(48vh,400px);overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
      .bsv-log-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11.5px;margin-bottom:10px}
      .bsv-term-out{height:min(46vh,380px);overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;padding:10px 12px;margin:0}
      .bsv-term-row{display:flex;gap:8px;margin-top:10px;align-items:center}
      .bsv-term-input{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .bsv-term-hint{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px}
      @media (max-width:720px){.bsv-root{padding:18px 16px 32px}.bsv-grid{grid-template-columns:1fr}.bsv-metrics{grid-template-columns:1fr}.bsv-row{flex-direction:column}.bsv-row>.bsv-field-narrow{flex:1;width:100%}.bsv-modal-wide{height:100%}}
    `

    function useT(ctx) {
      const [, bump] = React.useState(0)
      React.useEffect(
        () => ctx.locale.subscribe(() => bump((value) => value + 1)),
        [ctx],
      )
      return ctx.locale.bind(NS)
    }

    function fmt(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
      )
    }

    function isZh(ctx) {
      try {
        return String(ctx.locale.getLocale().active || '').toLowerCase().startsWith('zh')
      } catch {
        return false
      }
    }

    function formatBytesFromKb(kb) {
      if (!Number.isFinite(kb) || kb <= 0) return '—'
      const mb = kb / 1024
      if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
      return `${Math.round(mb)} MB`
    }

    function formatUptime(seconds, zh) {
      if (!Number.isFinite(seconds) || seconds < 0) return '—'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (zh) {
        if (days > 0) return `${days} 天 ${hours} 小时`
        if (hours > 0) return `${hours} 小时 ${minutes} 分`
        return `${minutes} 分`
      }
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      return `${minutes}m`
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '—'
      const seconds = Math.round(ms / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      return `${minutes}m ${seconds % 60}s`
    }

    function formatTime(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      try {
        return new Date(ms).toLocaleString()
      } catch {
        return new Date(ms).toISOString()
      }
    }

    function percentLabel(ratio) {
      if (!Number.isFinite(ratio)) return '—'
      return `${Math.round(ratio * 100)}%`
    }

    async function request(method, path, body) {
      const response = await fetch(`/build-servers${path}`, {
        method,
        headers: body
          ? { 'content-type': 'application/json', 'x-build-servers': '1' }
          : { 'x-build-servers': '1' },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        credentials: 'same-origin',
      })
      let data = {}
      try {
        data = await response.json()
      } catch {
        /* keep the status-based message */
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }
      return data
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${bytes} B`
    }

    function useEscape(active, onEscape) {
      React.useEffect(() => {
        if (!active) return undefined
        const handler = (event) => {
          if (event.key === 'Escape') onEscape()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
      }, [active, onEscape])
    }

    function useAutoScroll(ref, value) {
      React.useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
      }, [ref, value])
    }

    function MenuBuildIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('rect', {
          x: 3.2,
          y: 3.4,
          width: 9.6,
          height: 3.4,
          rx: 1.1,
          stroke: 'currentColor',
          strokeWidth: 1.1,
        }),
        h('rect', {
          x: 3.2,
          y: 9.2,
          width: 9.6,
          height: 3.4,
          rx: 1.1,
          stroke: 'currentColor',
          strokeWidth: 1.1,
        }),
        h('circle', { cx: 4.9, cy: 5.1, r: 0.55, fill: 'currentColor' }),
        h('circle', { cx: 4.9, cy: 10.9, r: 0.55, fill: 'currentColor' }),
      )
    }

    function BuildIcon(props) {
      const size = Number(props && props.size) || 18
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block', opacity: active ? 1 : 0.86 },
        },
        h('rect', {
          x: 2.35,
          y: 3.3,
          width: 15.3,
          height: 5.1,
          rx: 1.5,
          stroke: 'currentColor',
          strokeWidth: 1.35,
        }),
        h('rect', {
          x: 2.35,
          y: 11.6,
          width: 15.3,
          height: 5.1,
          rx: 1.5,
          stroke: 'currentColor',
          strokeWidth: 1.35,
        }),
        h('circle', { cx: 5.2, cy: 5.85, r: 0.95, fill: 'currentColor' }),
        h('path', {
          d: 'M5.35 13.05l1.55 1.45-1.55 1.45',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.55 15.95h3',
          stroke: 'currentColor',
          strokeWidth: 1.35,
          strokeLinecap: 'round',
        }),
      )
    }

    function Meter({ ratio }) {
      const level = ratio == null ? 'ok' : ratio >= 0.95 ? 'error' : ratio >= 0.85 ? 'warn' : 'ok'
      return h(
        'div',
        { className: 'bsv-meter', role: 'presentation' },
        h('div', {
          className: 'bsv-meter-fill',
          'data-level': level,
          style: { width: `${Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)))}%` },
        }),
      )
    }

    function Metric({ label, value, extra, ratio }) {
      return h(
        'div',
        { className: 'bsv-metric' },
        h(
          'div',
          { className: 'bsv-metric-label' },
          h('span', null, label),
          extra ? h('span', null, extra) : null,
        ),
        h('div', { className: 'bsv-metric-value', title: value }, value),
        ratio == null ? null : h(Meter, { ratio }),
      )
    }

    function stageName(key, t) {
      return t(`stage.${key}`)
    }

    function StageChip({ stageKey, stage, configured, t }) {
      const status = stage ? stage.status : configured ? 'idle' : 'skipped'
      const duration =
        stage && stage.startedAt && stage.endedAt
          ? formatDuration(stage.endedAt - stage.startedAt)
          : null
      const uploading =
        stage && stage.key === 'sync' && stage.status === 'running' && stage.bytes > 0
      const detail = !configured
        ? t('card.notConfigured')
        : stage
          ? t(`status.${stage.status}`)
          : t('status.idle')
      return h(
        'span',
        { className: 'bsv-stage', 'data-status': configured ? status : 'skipped' },
        h('span', { className: 'bsv-stage-dot', 'aria-hidden': 'true' }),
        h('span', null, stageName(stageKey, t)),
        h('span', { className: 'bsv-stage-time' }, detail),
        uploading
          ? h(
              'span',
              { className: 'bsv-stage-time' },
              fmt(t('stage.uploaded'), { size: formatBytes(stage.bytes) }),
            )
          : null,
        duration ? h('span', { className: 'bsv-stage-time' }, duration) : null,
      )
    }

    function PipelineStatus({ pipeline, t }) {
      if (!pipeline) return null
      const duration =
        pipeline.startedAt && pipeline.endedAt
          ? formatDuration(pipeline.endedAt - pipeline.startedAt)
          : pipeline.startedAt
            ? formatDuration(Date.now() - pipeline.startedAt)
            : null
      return h(
        'span',
        { className: 'bsv-build' },
        h(
          'span',
          { className: 'bsv-build-status', 'data-status': pipeline.status },
          t(`status.${pipeline.status}`),
        ),
        duration ? h('span', { className: 'bsv-muted' }, duration) : null,
      )
    }

    const MINI_CSS = `
      .bsv-mini{position:relative;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
      .bsv-mini-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}
      .bsv-mini-dot[data-state="online"]{background:var(--dsw-alias-state-success-primary)}
      .bsv-mini-dot[data-state="offline"]{background:var(--dsw-alias-state-error-primary)}
      .bsv-mini-dot[data-state="pending"]{background:var(--dsw-alias-brand-primary);animation:bsv-mini-pulse 1.1s ease-in-out infinite}
      .bsv-mini-dot[data-state="slow"]{background:var(--dsw-alias-state-warn-primary)}
      .bsv-mini-dot[data-state="unbound"]{background:var(--dsw-alias-state-idle-primary)}
      .bsv-mini-dot[data-state="running"]{background:var(--dsw-alias-state-success-primary);animation:bsv-mini-blink 1s ease-in-out infinite}
      @keyframes bsv-mini-blink{0%,100%{opacity:1}50%{opacity:.2}}
      .bsv-mini-chip{display:inline-flex;align-items:center;gap:6px;margin-left:0;align-self:auto;padding:3px 8px;border:0;border-radius:6px;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary)}
      .bsv-mini-chip:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent);color:var(--dsw-alias-label-primary)}
      .bsv-mini-chip:active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
      .bsv-mini-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .bsv-mini-wrap{display:contents}
      .bsv-mini-anchor{position:relative;display:inline-flex;margin-left:auto;align-self:flex-end}
      .bsv-mini-pop{position:fixed;left:auto;right:auto;top:auto;width:300px;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:200;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4;text-align:left}
      .bsv-mini-pop-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
      .bsv-mini-pop-title{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-mini-pop-status{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
      .bsv-mini-pop-os{color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-mini-pop-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;margin-bottom:10px}
      .bsv-mini-pop-label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .bsv-mini-pop-value{font-size:12px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-mini-stages{display:flex;gap:4px;flex-wrap:wrap}
      .bsv-mini-stage{padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}
      .bsv-mini-stage[data-active="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}
      .bsv-mini-pop-servers{display:flex;flex-direction:column;gap:5px}
      .bsv-mini-pop-server{width:100%;text-align:left;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;cursor:pointer}
      .bsv-mini-pop-server:hover{border-color:var(--dsw-alias-brand-primary)}
      .bsv-mini-pop-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}
      .bsv-mini-pop-btn{font:inherit;font-size:11.5px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
      .bsv-mini-pop-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent)}
      @keyframes bsv-mini-pulse{0%,100%{opacity:.35}50%{opacity:1}}
      .bsv-mini-name{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;max-width:32ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-mini-more{font:inherit;font-size:12px;line-height:1;padding:2px 6px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .bsv-mini-more:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .bsv-mini-menu{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:4px 0 0}
      .bsv-mini-item{font:inherit;font-size:11.5px;line-height:1;padding:4px 7px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
      .bsv-mini-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
      .bsv-mini-item:disabled{opacity:.45;cursor:default}
      .bsv-mini-error{color:var(--dsw-alias-state-error-primary);font-size:11px;max-width:40ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bsv-mini-term{flex-basis:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base)}
      .bsv-mini-term-head{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .bsv-mini-term-out{height:170px;overflow:auto;margin:0 0 5px;padding:5px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
      .bsv-mini-row{display:flex;gap:5px;align-items:center}
      .bsv-mini-input{flex:1;min-width:0;font:inherit;font-size:11px;padding:4px 7px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .bsv-mini-spacer{flex:1;min-width:4px}
    `

    function MiniBuildBar({ sessionId, ctx }) {
      const t = useT(ctx)
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const chipRef = React.useRef(null)
      const mounted = React.useRef(true)
      const refreshing = React.useRef(false)
      const pipelineStatus = state && state.pipeline ? state.pipeline.status : ''

      React.useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const refresh = React.useCallback(async () => {
        if (refreshing.current) return
        refreshing.current = true
        try {
          const data = await request('GET', `/session?session=${encodeURIComponent(sessionId)}`)
          if (mounted.current) {
            setState(data)
            setError('')
          }
        } catch (cause) {
          if (mounted.current) setError(cause.message || String(cause))
        } finally {
          refreshing.current = false
        }
      }, [sessionId])

      React.useEffect(() => {
        void refresh()
        const timer = window.setInterval(
          () => void refresh(),
          pipelineStatus === 'running' ? 1500 : 10000,
        )
        return () => window.clearInterval(timer)
      }, [refresh, pipelineStatus])

      React.useEffect(() => {
        const handler = () => void refresh()
        window.addEventListener('build-servers:changed', handler)
        return () => window.removeEventListener('build-servers:changed', handler)
      }, [refresh])

      if (!sessionId) return null

      const server = state ? state.server : null
      const probe = state ? state.probe : null
      const pipeline = state ? state.pipeline : null
      const running = pipeline && pipeline.status === 'running'
      const dotState = !server
        ? 'unbound'
        : !probe
          ? 'pending'
          : !probe.ok
            ? 'offline'
            : running
              ? 'running'
              : probe.latencyMs > 1200
                ? 'slow'
                : 'online'

      const togglePopover = () => {
        if (statusPopStore.sessionId === sessionId) {
          statusPopStore.hide()
          return
        }
        const rect = chipRef.current ? chipRef.current.getBoundingClientRect() : null
        if (!rect) return
        statusPopStore.show(
          sessionId,
          Math.max(8, rect.left),
          Math.max(8, window.innerHeight - rect.top + 6),
        )
      }

      return h(
        React.Fragment,
        null,
        h('style', null, MINI_CSS),
        h(
          'div',
          { className: 'bsv-mini-anchor' },
          h(
            'button',
            {
              type: 'button',
              className: 'bsv-mini-chip',
              ref: chipRef,
              'data-bsv-chip': 'true',
              'data-state': dotState,
              onClick: togglePopover,
              title: server ? `${server.name} · ${t('bar.details')}` : t('bar.unbound'),
            },
            h('span', { className: 'bsv-mini-dot', 'data-state': dotState, 'aria-hidden': 'true' }),
            h('span', { className: 'bsv-mini-name' }, server ? server.name : t('bar.unbound')),
            error ? h('span', { className: 'bsv-mini-error' }, error) : null,
          ),
        ),
      )
    }

    function emptyNetworkDraft() {
      return { id: '', name: '', target: '', port: '', enabled: true }
    }

    function NetworkEditor({ draft, t, onCancel, onSave, busy }) {
      const [form, setForm] = React.useState(draft)
      const [error, setError] = React.useState('')
      useEscape(true, onCancel)
      const update = (key) => (event) => {
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
        setForm((current) => ({ ...current, [key]: value }))
      }
      const submit = (event) => {
        event.preventDefault()
        if (!form.name.trim() || !form.target.trim()) {
          setError(t('editor.required'))
          return
        }
        onSave(form)
      }
      return h(
        'div',
        {
          className: 'bsv-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onCancel()
          },
        },
        h(
          'div',
          {
            className: 'bsv-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'bsv-net-title',
          },
          h(
            'form',
            { onSubmit: submit },
            h(
              'h2',
              { className: 'bsv-modal-title', id: 'bsv-net-title' },
              draft.id ? t('editor.editTitle') : t('editor.addTitle'),
            ),
            error ? h('p', { className: 'bsv-form-error', role: 'alert' }, error) : null,
            h(
              'div',
              { className: 'bsv-field' },
              h('label', { className: 'bsv-field-label', htmlFor: 'bsv-net-name' }, t('editor.name')),
              h('input', {
                id: 'bsv-net-name',
                className: 'bsv-input',
                value: form.name,
                onChange: update('name'),
                autoFocus: true,
                maxLength: 80,
                placeholder: 'build-host',
              }),
            ),
            h(
              'div',
              { className: 'bsv-row' },
              h(
                'div',
                { className: 'bsv-field' },
                h(
                  'label',
                  { className: 'bsv-field-label', htmlFor: 'bsv-net-target' },
                  t('editor.target'),
                ),
                h('input', {
                  id: 'bsv-net-target',
                  className: 'bsv-input bsv-input-mono',
                  value: form.target,
                  onChange: update('target'),
                  maxLength: 200,
                  placeholder: '10.0.0.8',
                  spellCheck: false,
                }),
                h('span', { className: 'bsv-field-hint' }, t('editor.targetHint')),
              ),
              h(
                'div',
                { className: 'bsv-field bsv-field-narrow' },
                h('label', { className: 'bsv-field-label', htmlFor: 'bsv-net-port' }, t('editor.port')),
                h('input', {
                  id: 'bsv-net-port',
                  className: 'bsv-input bsv-input-mono',
                  value: form.port,
                  onChange: update('port'),
                  inputMode: 'numeric',
                  placeholder: '22',
                }),
              ),
            ),
            h(
              'label',
              { className: 'bsv-check' },
              h('input', {
                type: 'checkbox',
                checked: form.enabled !== false,
                onChange: update('enabled'),
              }),
              t('editor.enabled'),
            ),
            h(
              'div',
              { className: 'bsv-modal-actions' },
              h(
                'button',
                { type: 'button', className: 'bsv-btn', onClick: onCancel, disabled: busy },
                t('actions.cancel'),
              ),
              h(
                'button',
                { type: 'submit', className: 'bsv-btn bsv-btn-primary', disabled: busy },
                t('actions.save'),
              ),
            ),
          ),
        ),
      )
    }

    function NetworkPanel({ ctx }) {
      const t = useT(ctx)
      const [servers, setServers] = React.useState(null)
      const [results, setResults] = React.useState({})
      const [probing, setProbing] = React.useState({})
      const [editing, setEditing] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [storeFile, setStoreFile] = React.useState('')
      const mounted = React.useRef(true)

      React.useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const probe = React.useCallback(async (list) => {
        const targets = (list || []).filter((server) => server.enabled !== false)
        if (targets.length === 0) return
        setProbing(Object.fromEntries(targets.map((server) => [server.id, true])))
        try {
          const data = await request('POST', '/probe', { ids: targets.map((server) => server.id) })
          if (!mounted.current) return
          const next = {}
          for (const item of data.results || []) next[item.id] = item
          setResults((current) => ({ ...current, ...next }))
        } catch (cause) {
          if (mounted.current) setError(cause.message || String(cause))
        } finally {
          if (mounted.current) setProbing({})
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const data = await request('GET', '/servers')
            if (cancelled) return
            setServers(data.servers || [])
            setStoreFile(data.file || '')
            if (data.warnings && data.warnings.length > 0) setError(data.warnings.join(' '))
            await probe(data.servers || [])
          } catch (cause) {
            if (!cancelled) setError(cause.message || String(cause))
          }
        })()
        return () => {
          cancelled = true
        }
      }, [probe])

      const save = async (form) => {
        setBusy(true)
        setError('')
        const draft = {
          ...form,
          name: form.name.trim(),
          target: form.target.trim(),
          port: String(form.port || '').trim(),
        }
        const next =
          editing.mode === 'edit'
            ? (servers || []).map((server) => (server.id === draft.id ? draft : server))
            : [...(servers || []), draft]
        try {
          const data = await request('PUT', '/servers', { servers: next })
          setServers(data.servers || [])
          setEditing(null)
          setNotice(t('notice.saved'))
          probe(data.servers || [])
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const remove = async (server) => {
        if (!window.confirm(`${t('delete.title')} ${server.name}`)) return
        setBusy(true)
        try {
          const next = (servers || []).filter((entry) => entry.id !== server.id)
          const data = await request('PUT', '/servers', { servers: next })
          setServers(data.servers || [])
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'bsv-root' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'bsv-header' },
          h(
            'div',
            null,
            h('h1', { className: 'bsv-title' }, t('panel.title')),
            h('p', { className: 'bsv-subtitle' }, t('panel.subtitle')),
          ),
          h(
            'div',
            { className: 'bsv-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'bsv-btn',
                onClick: () => probe(servers || []),
                disabled: !servers || servers.length === 0 || Object.keys(probing).length > 0,
              },
              t('actions.refresh'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bsv-btn bsv-btn-primary',
                onClick: () => setEditing({ mode: 'add', draft: emptyNetworkDraft() }),
              },
              t('actions.add'),
            ),
          ),
        ),

        error
          ? h(
              'div',
              { className: 'bsv-banner bsv-banner-error', role: 'alert' },
              h('span', null, error),
              h(
                'button',
                { type: 'button', className: 'bsv-btn bsv-btn-quiet', onClick: () => setError('') },
                t('error.dismiss'),
              ),
            )
          : null,
        notice
          ? h(
              'div',
              { className: 'bsv-banner bsv-banner-notice', role: 'status' },
              h('span', null, notice),
              h(
                'button',
                { type: 'button', className: 'bsv-btn bsv-btn-quiet', onClick: () => setNotice('') },
                t('error.dismiss'),
              ),
            )
          : null,

        servers === null
          ? h('div', { className: 'bsv-muted' }, t('loading'))
          : servers.length === 0
            ? h(
                'div',
                { className: 'bsv-empty' },
                h('div', { className: 'bsv-empty-icon' }, h(BuildIcon, { size: 34 })),
                h('h2', { className: 'bsv-empty-title' }, t('empty.title')),
                h('p', { className: 'bsv-empty-body' }, t('empty.body')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'bsv-btn bsv-btn-primary',
                    onClick: () => setEditing({ mode: 'add', draft: emptyNetworkDraft() }),
                  },
                  t('empty.action'),
                ),
              )
            : h(
                'div',
                { className: 'bsv-grid' },
                servers.map((server) => {
                  const result = results[server.id]
                  const status = probing[server.id]
                    ? 'probing'
                    : result
                      ? result.ok
                        ? 'online'
                        : 'offline'
                      : 'unknown'
                  return h(
                    'article',
                    { key: server.id, className: 'bsv-card', 'data-state': status },
                    h(
                      'div',
                      { className: 'bsv-card-head' },
                      h('span', { className: 'bsv-dot', 'aria-hidden': 'true' }),
                      h(
                        'div',
                        { className: 'bsv-card-title' },
                        h(
                          'div',
                          { className: 'bsv-name' },
                          h('span', { className: 'bsv-name-text', title: server.name }, server.name),
                          !server.enabled ? h('span', { className: 'bsv-tag' }, t('status.disabled')) : null,
                        ),
                        h(
                          'div',
                          { className: 'bsv-target' },
                          server.port ? `${server.target}:${server.port}` : server.target,
                        ),
                      ),
                      h(
                        'div',
                        { className: 'bsv-card-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'bsv-btn bsv-btn-quiet',
                            onClick: () => probe([server]),
                            disabled: Boolean(probing[server.id]) || !server.enabled,
                          },
                          t('actions.probe'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'bsv-btn bsv-btn-quiet',
                            onClick: () => setEditing({ mode: 'edit', draft: {
                              id: server.id,
                              name: server.name,
                              target: server.target,
                              port: server.port == null ? '' : String(server.port),
                              enabled: server.enabled !== false,
                            } }),
                          },
                          t('actions.edit'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'bsv-btn bsv-btn-quiet bsv-btn-danger',
                            onClick: () => remove(server),
                            disabled: busy,
                          },
                          t('actions.delete'),
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'bsv-os' },
                      result && result.ok
                        ? h(
                            React.Fragment,
                            null,
                            h('span', { className: 'bsv-os-name' }, result.os.name || result.os.id || '—'),
                            h('span', { className: 'bsv-tag' }, result.os.arch || '—'),
                            result.ip ? h('span', { className: 'bsv-mono' }, result.ip) : null,
                          )
                        : result
                          ? h('span', { className: 'bsv-offline' }, result.error || t('status.offline'))
                          : h('span', null, t('card.notProbed')),
                    ),
                  )
                }),
              ),

        storeFile ? h('p', { className: 'bsv-foot' }, `${t('panel.store')}: ${storeFile}`) : null,

        editing
          ? h(NetworkEditor, {
              draft: editing.draft,
              t,
              busy,
              onCancel: () => setEditing(null),
              onSave: save,
            })
          : null,
      )
    }

    function SessionSettingsDialog({ sessionId, settings, t, onClose, onSaved }) {
      const initial = settings || {}
      const [form, setForm] = React.useState({
        repoPath: initial.repoPath || '',
        localPath: initial.localPath || '',
        syncExclude: initial.syncExclude || '',
        stages: {
          build: (initial.stages && initial.stages.build) || '',
          install: (initial.stages && initial.stages.install) || '',
          test: (initial.stages && initial.stages.test) || '',
        },
      })
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      useEscape(true, onClose)
      const update = (key) => (event) => {
        const value = event.target.value
        setForm((current) => ({ ...current, [key]: value }))
      }
      const updateStage = (key) => (event) => {
        const value = event.target.value
        setForm((current) => ({ ...current, stages: { ...current.stages, [key]: value } }))
      }
      const submit = async (event) => {
        event.preventDefault()
        if (form.localPath.trim() && !form.repoPath.trim()) {
          setError(t('editor.repoRequired'))
          return
        }
        setBusy(true)
        setError('')
        try {
          const data = await request('PUT', '/session', {
            session: sessionId,
            settings: {
              repoPath: form.repoPath.trim(),
              localPath: form.localPath.trim(),
              syncExclude: form.syncExclude.trim(),
              stages: {
                build: form.stages.build,
                install: form.stages.install,
                test: form.stages.test,
              },
            },
          })
          onSaved(data.settings || {})
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        {
          className: 'bsv-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          {
            className: 'bsv-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'bsv-settings-title',
          },
          h(
            'form',
            { onSubmit: submit },
            h(
              'h2',
              { className: 'bsv-modal-title', id: 'bsv-settings-title' },
              t('settings.title'),
            ),
            h('p', { className: 'bsv-modal-body' }, t('settings.hint')),
            error ? h('p', { className: 'bsv-form-error', role: 'alert' }, error) : null,
            h(
              'div',
              { className: 'bsv-field' },
              h(
                'label',
                { className: 'bsv-field-label', htmlFor: 'bsv-settings-local' },
                t('editor.localPath'),
              ),
              h('input', {
                id: 'bsv-settings-local',
                className: 'bsv-input bsv-input-mono',
                value: form.localPath,
                onChange: update('localPath'),
                maxLength: 512,
                placeholder: 'D:\\src\\myproject',
                spellCheck: false,
              }),
              h('span', { className: 'bsv-field-hint' }, t('editor.localPathHint')),
            ),
            h(
              'div',
              { className: 'bsv-field' },
              h(
                'label',
                { className: 'bsv-field-label', htmlFor: 'bsv-settings-exclude' },
                t('editor.syncExclude'),
              ),
              h('input', {
                id: 'bsv-settings-exclude',
                className: 'bsv-input bsv-input-mono',
                value: form.syncExclude,
                onChange: update('syncExclude'),
                maxLength: 500,
                placeholder: '.git build node_modules .venv .dsh-plugins',
                spellCheck: false,
              }),
              h('span', { className: 'bsv-field-hint' }, t('editor.syncExcludeHint')),
            ),
            h(
              'div',
              { className: 'bsv-field' },
              h(
                'label',
                { className: 'bsv-field-label', htmlFor: 'bsv-settings-repo' },
                t('editor.repoPath'),
              ),
              h('input', {
                id: 'bsv-settings-repo',
                className: 'bsv-input bsv-input-mono',
                value: form.repoPath,
                onChange: update('repoPath'),
                maxLength: 512,
                placeholder: '~/src/myproject',
                spellCheck: false,
              }),
              h('span', { className: 'bsv-field-hint' }, t('editor.repoPathHint')),
            ),
            COMMAND_STAGES.map((key) =>
              h(
                'div',
                { className: 'bsv-field', key },
                h(
                  'label',
                  { className: 'bsv-field-label', htmlFor: `bsv-settings-${key}` },
                  t(`editor.${key}Command`),
                ),
                h('textarea', {
                  id: `bsv-settings-${key}`,
                  className: 'bsv-input bsv-input-mono bsv-textarea',
                  value: form.stages[key] || '',
                  onChange: updateStage(key),
                  rows: 2,
                  maxLength: 2000,
                  placeholder: t(`editor.${key}Hint`),
                  spellCheck: false,
                }),
              ),
            ),
            h(
              'div',
              { className: 'bsv-modal-actions' },
              h(
                'button',
                { type: 'button', className: 'bsv-btn', onClick: onClose, disabled: busy },
                t('actions.cancel'),
              ),
              h(
                'button',
                { type: 'submit', className: 'bsv-btn bsv-btn-primary', disabled: busy },
                t('actions.save'),
              ),
            ),
          ),
        ),
      )
    }

    function Panel({ ctx }) {
      return h(NetworkPanel, { ctx })
    }

    function SessionBindMenuItem({ sessionId, useMenuOpenState, ctx }) {
      const t = useT(ctx)
      const closeMenu = useMenuOpenState ? useMenuOpenState() : null
      const close = () => {
        if (typeof closeMenu === 'function') closeMenu()
        else if (closeMenu && typeof closeMenu.close === 'function') closeMenu.close()
      }
      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'bsv-menu-item',
            style: { display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' },
            onMouseEnter: (event) => event.currentTarget.setAttribute('data-highlighted', ''),
            onMouseLeave: (event) => event.currentTarget.removeAttribute('data-highlighted'),
            onFocus: (event) => event.currentTarget.setAttribute('data-highlighted', ''),
            onBlur: (event) => event.currentTarget.removeAttribute('data-highlighted'),
            onClick: () => {
              bindDialogStore.open(sessionId)
              close()
            },
          },
          h('span', { className: 'bsv-menu-icon' }, h(MenuBuildIcon)),
          h('span', { className: 'bsv-menu-label' }, t('actions.buildServerMenu')),
        ),
      )
    }

    function RightTabTerminalItem({ sessionId, dismiss, ctx }) {
      const t = useT(ctx)
      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'bsv-menu-item',
            style: { display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' },
            onMouseEnter: (event) => event.currentTarget.setAttribute('data-highlighted', ''),
            onMouseLeave: (event) => event.currentTarget.removeAttribute('data-highlighted'),
            onFocus: (event) => event.currentTarget.setAttribute('data-highlighted', ''),
            onBlur: (event) => event.currentTarget.removeAttribute('data-highlighted'),
            onClick: () => {
              bindDialogStore.open(sessionId, true)
              if (typeof dismiss === 'function') dismiss()
            },
          },
          h('span', { className: 'bsv-menu-icon' }, h(MenuBuildIcon)),
          h('span', { className: 'bsv-menu-label' }, t('actions.buildTerminal')),
        ),
      )
    }

    function BuildServerDialog({ sessionId, autoTerminal, ctx, onClose }) {
      const t = useT(ctx)
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [termOpen, setTermOpen] = React.useState(false)
      const [term, setTerm] = React.useState(null)
      const [termError, setTermError] = React.useState('')
      const [line, setLine] = React.useState('')
      const outputRef = React.useRef(null)
      useEscape(true, onClose)

      const refresh = React.useCallback(async () => {
        try {
          const data = await request('GET', `/session?session=${encodeURIComponent(sessionId)}`)
          setState(data)
          setError('')
        } catch (cause) {
          setError(cause.message || String(cause))
        }
      }, [sessionId])

      React.useEffect(() => {
        void refresh()
        const timer = window.setInterval(() => void refresh(), 2500)
        return () => window.clearInterval(timer)
      }, [refresh])

      const termId = term ? term.id : ''
      React.useEffect(() => {
        if (!termId) return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const data = await request('GET', `/terminal?session=${encodeURIComponent(termId)}`)
            if (!cancelled) {
              setTerm((current) =>
                current && current.id === data.session.id ? { ...current, ...data.session } : current,
              )
            }
          } catch (cause) {
            if (!cancelled) {
              setTermError(cause.message || String(cause))
              setTerm((current) => (current ? { ...current, alive: false } : current))
            }
          }
        }
        const timer = window.setInterval(tick, 800)
        return () => {
          cancelled = true
          window.clearInterval(timer)
        }
      }, [termId])
      useAutoScroll(outputRef, term ? term.output : '')

      const notify = () => {
        try {
          window.dispatchEvent(new CustomEvent('build-servers:changed'))
        } catch {
          /* older browsers */
        }
      }

      const bind = async (serverId) => {
        setBusy(true)
        setError('')
        try {
          await request('PUT', '/session', { session: sessionId, serverId })
          await refresh()
          notify()
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const configure = () => {
        try {
          ctx.layout.selectPanel(PANEL_ID)
        } catch {
          /* layout unavailable */
        }
        onClose()
      }

      const server = state ? state.server : null
      const servers = state ? state.servers || [] : []
      const settings = state ? state.settings : null
      const probe = state ? state.probe : null
      const pipeline = state ? state.pipeline : null
      const running = pipeline && pipeline.status === 'running'
      const canRun =
        server &&
        settings &&
        (settings.localPath ||
          ['build', 'install', 'test'].some((key) => settings.stages && settings.stages[key]))

      const run = async () => {
        setBusy(true)
        setError('')
        try {
          await request('POST', '/pipelines', { session: sessionId })
          await refresh()
          notify()
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const stop = async () => {
        if (!pipeline) return
        setBusy(true)
        try {
          await request('POST', '/pipelines/stop', { job: pipeline.id })
          await refresh()
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const openTerm = async () => {
        if (!server) return
        setTermOpen(true)
        setTerm(null)
        setTermError('')
        setBusy(true)
        try {
          const data = await request('POST', '/terminal/open', { id: server.id })
          setTerm(data.session)
        } catch (cause) {
          setTermError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const closeTerm = async () => {
        if (term) {
          await request('POST', '/terminal/close', { session: term.id }).catch(() => {})
        }
        setTermOpen(false)
        setTerm(null)
        setTermError('')
      }

      const send = async (data) => {
        if (!term || !term.alive) return
        try {
          await request('POST', '/terminal/input', { session: term.id, data })
        } catch (cause) {
          setTermError(cause.message || String(cause))
        }
      }

      const submit = () => {
        if (!term || !term.alive) return
        void send(`${line}\n`)
        setLine('')
      }

      React.useEffect(() => {
        if (autoTerminal && state && state.server && !termOpen && !term) {
          void openTerm()
        }
      }, [autoTerminal, state && state.server && state.server.id])

      return h(
        'div',
        {
          className: 'bsv-backdrop',
          style: { pointerEvents: 'auto' },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          {
            className: 'bsv-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'bsv-bind-title',
          },
          h('style', null, CSS),
          h('style', null, MINI_CSS),
          h('h2', { className: 'bsv-modal-title', id: 'bsv-bind-title' }, t('dialog.title')),
          h(
            'p',
            { className: 'bsv-modal-body' },
            server ? fmt(t('dialog.bound'), { name: server.name }) : t('dialog.unbound'),
          ),
          probe && probe.ok
            ? h(
                'div',
                { className: 'bsv-os' },
                h('span', { className: 'bsv-os-name' }, probe.os.name || probe.os.id || '—'),
                h('span', { className: 'bsv-tag' }, probe.os.arch || '—'),
                probe.ip ? h('span', { className: 'bsv-mono' }, probe.ip) : null,
                probe.user
                  ? h('span', { className: 'bsv-muted' }, `${probe.user}@${probe.hostname}`)
                  : null,
              )
            : probe
              ? h('div', { className: 'bsv-offline' }, probe.error || t('status.offline'))
              : null,
          probe && probe.ok
            ? h(
                'div',
                { className: 'bsv-metrics', style: { marginTop: '10px' } },
                h(Metric, {
                  label: t('card.load'),
                  value:
                    probe.load && probe.load.length
                      ? probe.load.map((n) => n.toFixed(2)).join(' / ')
                      : '—',
                  extra: probe.cpus ? fmt(t('card.cpus'), { count: probe.cpus }) : null,
                }),
                h(Metric, {
                  label: t('card.memory'),
                  value:
                    probe.memTotalKb && probe.memAvailableKb != null
                      ? `${percentLabel(probe.memUsedRatio)} · ${formatBytesFromKb(probe.memTotalKb - probe.memAvailableKb)} / ${formatBytesFromKb(probe.memTotalKb)}`
                      : '—',
                  ratio: probe.memUsedRatio,
                }),
                h(Metric, {
                  label: t('card.disk'),
                  value: probe.disk
                    ? `${percentLabel(probe.disk.percent / 100)} · ${formatBytesFromKb(probe.disk.usedKb)} / ${formatBytesFromKb(probe.disk.totalKb)}`
                    : '—',
                  ratio: probe.disk ? probe.disk.percent / 100 : null,
                }),
                h(Metric, {
                  label: t('card.uptime'),
                  value: formatUptime(probe.uptimeSec, isZh(ctx)),
                  extra: `${probe.latencyMs} ms`,
                }),
              )
            : null,
          pipeline
            ? h(
                'div',
                { className: 'bsv-pipeline', style: { marginTop: '12px' } },
                h(
                  'div',
                  { className: 'bsv-pipeline-head' },
                  h('span', { className: 'bsv-pipeline-label' }, t('card.pipeline')),
                  h(
                    'div',
                    { className: 'bsv-stages' },
                    STAGE_KEYS.map((key) =>
                      h(StageChip, {
                        key,
                        stageKey: key,
                        stage: pipeline.stages.find((entry) => entry.key === key),
                        configured:
                          settings &&
                          (key === 'sync'
                            ? Boolean(settings.localPath)
                            : Boolean(settings.stages && settings.stages[key])),
                        t,
                      }),
                    ),
                  ),
                  h('span', { className: 'bsv-spacer' }),
                  h(PipelineStatus, { pipeline, t }),
                ),
              )
            : null,
          error ? h('p', { className: 'bsv-form-error', role: 'alert' }, error) : null,
          state === null
            ? h('p', { className: 'bsv-muted' }, t('loading'))
            : servers.length === 0
              ? h('p', { className: 'bsv-modal-body' }, t('dialog.noServers'))
              : h(
                  'div',
                  { className: 'bsv-server-list' },
                  servers.map((entry) =>
                    h(
                      'button',
                      {
                        key: entry.id,
                        type: 'button',
                        className: 'bsv-server-option',
                        'data-current': server && server.id === entry.id ? 'true' : 'false',
                        onClick: () => bind(entry.id),
                        disabled: busy,
                      },
                      h('span', { className: 'bsv-name-text' }, entry.name),
                      h('span', { className: 'bsv-target' }, entry.target),
                      h('span', { className: 'bsv-spacer' }),
                      server && server.id === entry.id
                        ? h('span', { className: 'bsv-tag' }, t('dialog.current'))
                        : null,
                    ),
                  ),
                ),
          h(
            'div',
            { className: 'bsv-modal-actions' },
            canRun
              ? running
                ? h(
                    'button',
                    { type: 'button', className: 'bsv-btn', onClick: stop, disabled: busy },
                    t('actions.stop'),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'bsv-btn bsv-btn-primary',
                      onClick: run,
                      disabled: busy,
                    },
                    t('actions.buildNow'),
                  )
              : null,
            server
              ? h(
                  'button',
                  { type: 'button', className: 'bsv-btn', onClick: termOpen ? closeTerm : openTerm, disabled: busy },
                  termOpen ? t('actions.hideTerminal') : t('actions.newTerminal'),
                )
              : null,
            server
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'bsv-btn',
                    onClick: () => bind(null),
                    disabled: busy,
                  },
                  t('actions.unbind'),
                )
              : null,
            h(
              'button',
              { type: 'button', className: 'bsv-btn', onClick: configure },
              t('actions.configure'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'bsv-btn',
                onClick: () => setSettingsOpen(true),
              },
              t('actions.settings'),
            ),
            h('button', { type: 'button', className: 'bsv-btn bsv-btn-primary', onClick: onClose }, t('actions.close')),
          ),
          termOpen
            ? h(
                'div',
                { className: 'bsv-mini-term', style: { marginTop: '12px' } },
                h(
                  'div',
                  { className: 'bsv-mini-term-head' },
                  h('span', null, server ? server.name : ''),
                  term
                    ? term.alive
                      ? h('span', null, t('terminal.connected'))
                      : h(
                          'span',
                          null,
                          fmt(t('terminal.exited'), {
                            code: term.exitCode == null ? '—' : term.exitCode,
                          }),
                        )
                    : h('span', null, t('terminal.connecting')),
                  h('span', { className: 'bsv-mini-spacer' }),
                  h(
                    'button',
                    { type: 'button', className: 'bsv-mini-item', onClick: closeTerm },
                    t('actions.close'),
                  ),
                ),
                termError ? h('div', { className: 'bsv-mini-error' }, termError) : null,
                h(
                  'pre',
                  { className: 'bsv-mini-term-out', ref: outputRef, tabIndex: 0 },
                  (term ? term.output : '') ||
                    (term ? t('terminal.outputEmpty') : t('terminal.connecting')),
                ),
                h(
                  'div',
                  { className: 'bsv-mini-row' },
                  h('input', {
                    className: 'bsv-mini-input',
                    value: line,
                    onChange: (event) => setLine(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submit()
                      }
                    },
                    placeholder: t('terminal.placeholder'),
                    spellCheck: false,
                    disabled: !term || !term.alive,
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'bsv-mini-item',
                      onClick: submit,
                      disabled: !term || !term.alive || busy,
                    },
                    t('actions.send'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'bsv-mini-item',
                      onClick: () => void send('\u0003'),
                      disabled: !term || !term.alive,
                    },
                    t('actions.ctrlC'),
                  ),
                ),
              )
            : null,
          settingsOpen
            ? h(SessionSettingsDialog, {
                sessionId,
                settings: state ? state.settings : null,
                t,
                onClose: () => setSettingsOpen(false),
                onSaved: (next) => {
                  setState((current) => ({ ...current, settings: next }))
                  setSettingsOpen(false)
                  notify()
                },
              })
            : null,
        ),
      )
    }

    function StatusPopoverHost({ ctx }) {
      const t = useT(ctx)
      const snapshot = () =>
        statusPopStore.sessionId
          ? {
              sessionId: statusPopStore.sessionId,
              left: statusPopStore.left,
              bottom: statusPopStore.bottom,
            }
          : null
      const [target, setTarget] = React.useState(snapshot)
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      React.useEffect(() => statusPopStore.subscribe(() => setTarget(snapshot())), [])

      const sessionId = target ? target.sessionId : ''

      const refresh = React.useCallback(async () => {
        if (!sessionId) return
        try {
          const next = await request('GET', `/session?session=${encodeURIComponent(sessionId)}`)
          setData(next)
          setError('')
        } catch (cause) {
          setError(cause.message || String(cause))
        }
      }, [sessionId])

      React.useEffect(() => {
        if (!sessionId) {
          setData(null)
          return undefined
        }
        void refresh()
        const timer = window.setInterval(refresh, 2500)
        return () => window.clearInterval(timer)
      }, [refresh, sessionId])

      React.useEffect(() => {
        if (!sessionId) return undefined
        const onDown = (event) => {
          if (event.target.closest('.bsv-mini-pop')) return
          if (event.target.closest('[data-bsv-chip]')) return
          statusPopStore.hide()
        }
        const onKey = (event) => {
          if (event.key === 'Escape') statusPopStore.hide()
        }
        document.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          window.removeEventListener('keydown', onKey)
        }
      }, [sessionId])

      if (!target) return null

      const server = data ? data.server : null
      const probe = data ? data.probe : null
      const pipeline = data ? data.pipeline : null
      const running = pipeline && pipeline.status === 'running'
      const activeStage = running ? pipeline.current : null
      const statusText = !server
        ? t('bar.unbound')
        : !probe
          ? t('status.probing')
          : !probe.ok
            ? t('status.offline')
            : probe.latencyMs > 1200
              ? t('bar.slow')
              : t('status.online')
      const headerStatus = running ? t('status.running') : statusText
      const dotState = !server
        ? 'unbound'
        : !probe
          ? 'pending'
          : !probe.ok
            ? 'offline'
            : running
              ? 'running'
              : probe.latencyMs > 1200
                ? 'slow'
                : 'online'

      const bind = async (serverIdValue) => {
        setBusy(true)
        try {
          await request('PUT', '/session', { session: sessionId, serverId: serverIdValue })
          await refresh()
          window.dispatchEvent(new CustomEvent('build-servers:changed'))
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setBusy(false)
        }
      }

      const configure = () => {
        statusPopStore.hide()
        try {
          ctx.layout.selectPanel(PANEL_ID)
        } catch {
          /* layout unavailable */
        }
      }

      const metric = (label, value) =>
        h(
          'div',
          { className: 'bsv-mini-pop-metric' },
          h('div', { className: 'bsv-mini-pop-label' }, label),
          h('div', { className: 'bsv-mini-pop-value' }, value),
        )

      return h(
        'div',
        {
          className: 'bsv-mini-pop',
          style: {
            left: target.left,
            bottom: target.bottom,
            pointerEvents: 'auto',
          },
        },
        h('style', null, CSS),
        h('style', null, MINI_CSS),
        h(
          'div',
          { className: 'bsv-mini-pop-head' },
          h('span', { className: 'bsv-mini-dot', 'data-state': dotState, 'aria-hidden': 'true' }),
          h('span', { className: 'bsv-mini-pop-title' }, server ? server.name : t('bar.unbound')),
          h('span', { className: 'bsv-mini-pop-status' }, headerStatus),
        ),
        server && probe && probe.ok
          ? h(
              'div',
              { className: 'bsv-mini-pop-os' },
              `${probe.os.name || probe.os.id} · ${probe.os.arch}${probe.ip ? ` · ${probe.ip}` : ''}`,
            )
          : null,
        server && probe && probe.ok
          ? h(
              'div',
              { className: 'bsv-mini-pop-grid' },
              metric(
                t('card.load'),
                probe.load && probe.load.length
                  ? probe.load.map((n) => n.toFixed(2)).join(' / ')
                  : '—',
              ),
              metric(t('card.memory'), percentLabel(probe.memUsedRatio)),
              metric(t('card.disk'), probe.disk ? `${probe.disk.percent}%` : '—'),
              metric(t('card.uptime'), formatUptime(probe.uptimeSec, isZh(ctx))),
            )
          : null,
        error ? h('div', { className: 'bsv-mini-error' }, error) : null,
        server
          ? h(
              'div',
              { className: 'bsv-mini-stages' },
              STAGE_KEYS.map((key) =>
                h(
                  'span',
                  {
                    key,
                    className: 'bsv-mini-stage',
                    'data-active': activeStage === key ? 'true' : 'false',
                  },
                  stageName(key, t),
                ),
              ),
            )
          : h(
              'div',
              { className: 'bsv-mini-pop-servers' },
              (data ? data.servers || [] : []).map((entry) =>
                h(
                  'button',
                  {
                    key: entry.id,
                    type: 'button',
                    className: 'bsv-mini-pop-server',
                    onClick: () => bind(entry.id),
                    disabled: busy,
                  },
                  entry.name,
                ),
              ),
            ),
        h(
          'div',
          { className: 'bsv-mini-pop-actions' },
          server
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'bsv-mini-pop-btn',
                  onClick: () => {
                    statusPopStore.hide()
                    bindDialogStore.open(sessionId)
                  },
                },
                t('bar.details'),
              )
            : null,
          h(
            'button',
            { type: 'button', className: 'bsv-mini-pop-btn', onClick: configure },
            t('actions.configure'),
          ),
        ),
      )
    }

    function BindDialogHost({ ctx }) {
      const snapshot = () => ({
        sessionId: bindDialogStore.sessionId,
        autoTerminal: bindDialogStore.autoTerminal,
        version: bindDialogStore.version,
      })
      const [state, setState] = React.useState(snapshot)
      React.useEffect(() => bindDialogStore.subscribe(() => setState(snapshot())), [])
      if (!state.sessionId) return null
      return h(BuildServerDialog, {
        key: state.version,
        sessionId: state.sessionId,
        autoTerminal: state.autoTerminal,
        ctx,
        onClose: () => bindDialogStore.close(),
      })
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          const en = ctx.locale.register(NS, 'en', EN)
          const zh = ctx.locale.register(NS, 'zh', ZH)
          return () => {
            en()
            zh()
          }
        })
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('nav.label'),
            },
            BuildIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, (props) => h(Panel, { ...props, ctx })),
        )
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'build-servers-mini', order: 40 },
            (props) => h(MiniBuildBar, { sessionId: props.sessionId, ctx }),
          ),
        )
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'build-servers-bind', order: 250 },
            (props) => h(SessionBindMenuItem, { ...props, ctx }),
          ),
        )
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.menu.item', id: 'build-servers-terminal', order: 100 },
            (props) => h(RightTabTerminalItem, { ...props, ctx }),
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'build-servers-dialog', order: 50 },
            () => h(BindDialogHost, { ctx }),
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'build-servers-status-pop', order: 51 },
            () => h(StatusPopoverHost, { ctx }),
          ),
        )
      },
    }
  },
})
