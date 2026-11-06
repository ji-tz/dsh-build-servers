# DSH Build Servers

A [DeepSeek Harness](https://github.com/deepseek-ai) bundle for working with remote build machines from inside a conversation: bind one server to the current session, upload local source, run **build → install → test**, watch the result, and open an SSH shell without leaving the chat.

> Status: v0.1.0, early but usable. The bundle is tested against a Red Hat Enterprise Linux 8 build host from Windows. It is not a CI system; it is a small, inspectable bridge to one machine at a time.

## Features

- **Network-only server panel** — name, SSH target/alias, port, enable/disable, live OS/IP probe. No paths or commands are stored on the server entry.
- **Per-session binding** — each conversation binds one server. A workspace remembers the last server used, and new sessions in that workspace inherit it; an explicit unbind is remembered too.
- **Session compile settings** — local source directory, remote build path, upload excludes, and the `build` / `install` / `test` commands are stored per session.
- **Upload → build → install → test** — local `tar` piped into `ssh … tar -x`, followed by the configured stages through `bash -lc`; stops at the first failure and can be stopped mid-stage. Live stage status, exit codes, durations, and output.
- **SSH terminal** — a persistent `ssh -tt … bash -l` per server, shared by the UI, the session dialog, and the agent tools. Line mode (no full-screen TUI).
- **Conversation status chip** — a green/amber/red dot plus the server name at the bottom of the composer; clicking opens an in-place status popover with load, memory, disk, uptime, and the current pipeline stage.
- **Agent tools** — `build_server` (`status` / `run` / `pipeline` / `stop`) and `remote_terminal` (`list` / `open` / `send` / `read` / `close`), so the model can drive the same server and shell as the UI.

## Requirements

- A DeepSeek Harness installation with the Web UI and `plugin_manager` (this bundle targets the 0.2.x bundle API).
- A local OpenSSH client with key-based, non-interactive authentication to the build host (`BatchMode=yes`). Passwords and keys are never stored by this plugin.
- `tar` on the local machine and on the build host.
- A POSIX shell on the build host (`/proc`, `hostname`, `sed`, `awk`, `find`, `df`, `git` are used opportunistically).

## Install

From a checkout of this repository:

```text
plugin_manager install_bundle
  target: D:\path\to\dsh-build-servers
```

Or, after pushing a commit:

```text
plugin_manager install_bundle
  target: git+https://github.com/ji-tz/dsh-build-servers.git#<commit>
```

If the package lives in a subdirectory of a larger repository, append `&path:/build-servers` to the Git spec.

The plugin is enabled immediately. If the sidebar or composer does not show the new entries, reload the page once (`Ctrl+R`); the client half is served as a bundle.

## Use

1. Open the left sidebar's **Build servers** panel and add a server: display name, SSH target (alias / `user@host` / IP), optional port.
2. In a conversation, open the session row's `...` menu → **Build server…**, pick the server, and fill in **Compile settings**: local source path, remote build path, upload excludes, and the stage commands.
3. The bottom status chip now shows the server. Click it for load/memory/disk and the stage status. Run a pipeline from the session dialog or the chip's popover; logs are in the same dialog.
4. The session menu, the right sidebar tab menu (**Build server terminal**), and the status chip all reach the same server. Agent tools use the same binding.

## Storage

The plugin keeps its state under `~/.dsh` (or `%USERPROFILE%\.dsh` on Windows):

| File | Contents |
|---|---|
| `build-servers.json` | Network entries only: id, name, target, port, enabled |
| `build-server-bindings.json` | Per-session bindings and per-workspace last-used server |
| `build-server-settings.json` | Per-session paths, excludes, and stage commands |

Nothing is written to the remote machine except the uploaded source and whatever the configured commands do.

## Security

- All SSH traffic uses your local OpenSSH configuration and agent; the plugin never sees passwords.
- The Host route is bound to the same local Web server as the UI, requires a same-origin marker header for mutations, and is not reachable from other origins.
- `build` / `install` / `test` and the terminal run **arbitrary commands** with your SSH identity. Only add machines you trust, and keep the stage commands and shell contents under review.
- The `remote_terminal` and `build_server` tools execute without an extra approval prompt. If you need approval, add a `ctx.tools.guard()` or gate the tools in the preset.

## Limitations

- The terminal is line-oriented; full-screen applications (`vim`, `top`) are not supported.
- The status popover and the build dialog use frame-level overlays; they are positioned from the chip's bounding box and close on outside click / `Escape`.
- The bundle is not published to an npm registry under a public scope yet; the package name is still `@local/build-servers`. The GitHub repository is the source of truth for now.
- No automated UI tests. Host-side behavior is exercised manually against a real build machine.

## Development

The bundle is plain JavaScript; there is no build step.

| File | Role |
|---|---|
| `index.js` | Host half: HTTP prefix route `/build-servers`, SSH probes, upload, pipeline, terminals, agent tools |
| `client.js` | Browser half: sidebar panel, status chip, dialogs, menus, terminal UI |
| `cordis.patch.yml` | Loader row inserted into the profile |
| `DESIGN.md` | Architecture and design notes |
| `locale/*.json` | Plugin Manager metadata (title/description) |
| `icon.svg` | Bundle icon |

After editing, reload the plugin from Plugin Manager (toggle it off/on) and refresh the page. The Host reads `index.js` at activation; the browser reads the served Client bundle on page load.

## License

MIT — see [LICENSE](LICENSE).
