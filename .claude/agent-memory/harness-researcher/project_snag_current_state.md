---
name: snag project current state (2026-03-22)
description: Complete inventory of what exists in /home/emeric/code/snag — full implementation exists with complete source, docs, CI, packaging
type: project
---

The snag project at /home/emeric/code/snag is **fully implemented** as of 2026-03-22.

**Why:** The initial implementation was completed in two commits on 2026-03-22.

**Git history (most recent first):**
- `986e411` fix(daemon): use O_NONBLOCK and libc::read for PTY async I/O
- `7ea8393` feat: initial implementation of snag PTY session multiplexer
- Remote: git@github.com:moukrea/snag.git (branch: main, up to date)
- Untracked: .claude/ and .harness/ (not committed)

**All source files (complete):**
- src/main.rs — tokio current_thread main, clap dispatch
- src/error.rs — SnagError enum, Display, From<io::Error>, From<nix::Error>
- src/config.rs — Config struct with serde defaults, load(), socket_path(), pid_path(), default_shell()
- src/client.rs — DaemonClient (connect+auto-start, request, read_response, send_raw, send_resize, send_detach, into_stream)
- src/cli/mod.rs — Cli/Command/DaemonAction clap structs
- src/cli/commands.rs — All command handlers (cmd_new, cmd_kill, cmd_rename, cmd_list, cmd_info, cmd_attach, cmd_send, cmd_output, cmd_cwd, cmd_ps, cmd_scan, cmd_adopt, cmd_daemon_start/stop/status) plus key_event_to_bytes
- src/cli/output.rs — print_session_list, print_session_list_json, print_session_info[_json], print_scan_results, print_process_list
- src/protocol/types.rs — All message type constants, Request/Response/ResponseData enums, SessionInfo, ProcessEntry, DiscoveredSession structs
- src/protocol/codec.rs — encode_request, encode_response, write_frame, read_frame, decode_request, decode_response
- src/daemon/mod.rs — re-exports submodules
- src/daemon/server.rs — run_daemon(), DaemonEvent enum, handle_client_connection(), handle_request() dispatcher, all handle_* fns, pty_read_loop()
- src/daemon/session.rs — Session struct, new_spawned, new_adopted, to_info(), generate_session_id(), validate_session_name(), chrono_now() (no external dep), days_to_ymd()
- src/daemon/registry.rs — SessionRegistry (HashMap + name_index), insert/remove/get/get_mut/resolve/resolve_session/resolve_session_mut/rename/has_name/iter/iter_mut/len/is_empty/session_ids
- src/daemon/pty.rs — spawn_shell(), set_winsize(), get_pts_path(), reap_child(), kill_session(), read_cwd(), read_comm(), fg_process()
- src/daemon/adopt.rs — scan_pty_sessions(), get_pts_number_for_fd(), find_slave_process(), adopt_pty() (pidfd_open + pidfd_getfd syscalls)
- src/daemon/ringbuf.rs — RingBuffer, write(), as_slices(), last_n_lines(), all_bytes(), len(), is_empty(), clear(); unit tests for wrap-around correctness
- src/tui/mod.rs — run_tui(), refresh_sessions(), refresh_preview(), cleanup_terminal()
- src/tui/app.rs — App struct, select_next/prev, selected_session, selected_id
- src/tui/ui.rs — draw() with ratatui: 3-pane layout (session list, preview, status bar)

**No tests/ directory** — described in CONTRIBUTING.md/tech-spec but not yet created.

**How to apply:** Never assume snag is pre-implementation. All source files listed above exist and compile.
