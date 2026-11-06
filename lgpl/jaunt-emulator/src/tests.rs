// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) moukrea for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! tests/test_screen.py, on the Rust log. The differential corpus (tests/emulator_corpus.rs) holds the rest against Python.

use super::*;

fn plain(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find("\x1b[") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        match after.find(|c: char| !(c.is_ascii_digit() || c == ';')) {
            Some(j) if after.as_bytes()[j] == b'm' => rest = &after[j + 1..],
            _ => {
                out.push_str("\x1b[");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

struct Fed {
    log: ScreenLog,
    at: u64,
}

impl Fed {
    fn new(cols: i64, rows: i64, lines: usize) -> Fed {
        Fed {
            log: ScreenLog::new(cols, rows, lines),
            at: 0,
        }
    }

    fn feed(&mut self, chunks: &[&[u8]]) {
        for c in chunks {
            self.log.feed(self.at, c, false);
            self.at += c.len() as u64;
        }
        self.log.drain();
    }

    fn resize(&mut self, cols: i64, rows: i64) {
        self.log.resize(cols, rows);
        self.log.drain();
    }

    fn screen_text(&mut self) -> String {
        plain(&String::from_utf8(self.log.snapshot(0, b"").1).unwrap())
    }

    fn rows(&mut self) -> Vec<String> {
        self.log
            .rows_text_dim()
            .rows
            .iter()
            .map(|r| {
                r.iter()
                    .map(|(t, _)| t.to_string_lossless())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
            })
            .collect()
    }
}

#[test]
fn history_is_the_lines_that_left_the_screen_joined_and_bounded() {
    let mut f = Fed::new(20, 5, 50);
    let flood: Vec<u8> = (0..100)
        .flat_map(|i| format!("line {i:03}\r\n").into_bytes())
        .collect();
    f.feed(&[&flood]);
    let history: Vec<String> = f.log.lines().iter().map(|l| plain(l)).collect();
    assert_eq!(history.len(), 50);
    assert_eq!(history.last().unwrap(), "line 095");
    // A long line wrapped over several rows comes back as one logical line, to rewrap anywhere.
    let mut long = b"\x1b[31m".to_vec();
    long.extend([b'x'; 45]);
    long.extend(b"\x1b[0m\r\n");
    long.extend(b"\r\n".repeat(5));
    f.feed(&[&long]);
    let joined: Vec<String> = f
        .log
        .lines()
        .into_iter()
        .filter(|l| plain(l).contains('x'))
        .collect();
    assert_eq!(joined.len(), 1);
    assert_eq!(plain(&joined[0]), "x".repeat(45));
    assert!(joined[0].contains("\x1b[0;31m"));
}

#[test]
fn alternate_screen_and_clears_stay_out_of_the_history() {
    let mut f = Fed::new(20, 5, 50);
    let before = b"before\r\n".repeat(6);
    let mut tui = b"\x1b[?1049h".to_vec();
    tui.extend(b"tui frame\r\n".repeat(20));
    tui.extend(b"\x1b[?1049l");
    f.feed(&[&before, &tui]);
    assert!(
        !f.log.lines().iter().any(|l| l.contains("tui"))
            && f.log.lines().iter().any(|l| l.contains("before"))
    );
    let (_, data, size) = f.log.snapshot(50, b"");
    let data = String::from_utf8(data).unwrap();
    assert_eq!(size, (20, 5));
    assert!(data.contains("before") && !data.contains("tui"));
    f.feed(&[b"\x1b[3J"]);
    assert!(
        f.log.lines().is_empty(),
        "ED 3 clears the scrollback, as xterm does"
    );
}

#[test]
fn snapshot_draws_an_alternate_screen_over_the_normal_one() {
    let mut f = Fed::new(20, 5, 50);
    f.feed(&[
        b"shell prompt\r\n",
        b"\x1b[?1049h\x1b[H\x1b[2Jfull screen app",
    ]);
    let (at, data, _) = f.log.snapshot(10, b"");
    let data = String::from_utf8(data).unwrap();
    let (a, b, c) = (
        data.find("shell prompt").unwrap(),
        data.find("\x1b[?1049h").unwrap(),
        data.find("full screen app").unwrap(),
    );
    assert!(a < b && b < c);
    assert_eq!(at, f.at);
}

#[test]
fn shrinking_the_screen_pushes_rows_above_the_cursor_into_the_history() {
    let mut f = Fed::new(20, 6, 50);
    let rows: Vec<u8> = (0..5)
        .flat_map(|i| format!("row {i}\r\n").into_bytes())
        .collect();
    f.feed(&[&rows]);
    f.resize(20, 3);
    assert_eq!(
        f.log.lines().iter().map(|l| plain(l)).collect::<Vec<_>>(),
        ["row 0", "row 1", "row 2"]
    );
}

#[test]
fn emoji_and_clusters_take_the_cells_xterm_gives_them() {
    let mut f = Fed::new(10, 3, 50);
    // An emoji selector used to stop pyte from drawing the rest of the chunk.
    f.feed(&["⚠️ ok 🤖x".as_bytes()]);
    let rows = f.log.rows_text_dim();
    let row: Vec<String> = rows.rows[0]
        .iter()
        .map(|(t, _)| t.to_string_lossless())
        .collect();
    assert_eq!(row[0], "⚠️");
    assert_eq!(row[1], " "); // the second half reads as a space
    assert_eq!(row[3], "o");
    assert_eq!(row[6], "🤖");
    assert_eq!(row[8], "x");
}

#[test]
fn dim_palette_colon_forms_and_strings_do_not_leak_into_the_history() {
    let mut f = Fed::new(40, 3, 50);
    let mut out =
        b"\x1b[2mdim\x1b[22m \x1b[38;5;208mpal\x1b[0m \x1b[4:3mcurl\x1b[4:0m \x1b[>4;2mkeys"
            .to_vec();
    out.extend(
        b"\x1bP+q544e\x1b\\\x1b]8;;http://x\x07link\x1b]8;;\x07\x1b[!p\x1b_Gpayload\x1b\\ end\r\n",
    );
    out.extend(b"\r\n".repeat(3));
    f.feed(&[&out]);
    let line = f
        .log
        .lines()
        .into_iter()
        .find(|l| l.contains("dim"))
        .unwrap();
    assert_eq!(plain(&line), "dim pal curl keyslink end");
    assert!(line.contains("\x1b[0;2m") && line.contains("38;5;208"));
    assert!(!line.split("keys").nth(1).unwrap().contains("\x1b[0;4m"));
}

#[test]
fn a_string_split_across_chunks_is_swallowed() {
    let mut f = Fed::new(40, 3, 50);
    let mut first = b"a\x1b]52;c;".to_vec();
    first.extend(b"QUFB".repeat(1000));
    f.feed(&[&first, b"QUFB\x1b", b"\\b"]);
    assert!(f.screen_text().starts_with("ab"));
}

#[test]
fn a_narrower_screen_reflows_instead_of_cutting_lines() {
    let mut f = Fed::new(30, 5, 50);
    let mut out = vec![b'x'; 25];
    out.extend(b"\r\n$ ");
    f.feed(&[&out]);
    f.resize(10, 5);
    f.feed(&[&b"\r\n".repeat(10)]);
    let lines: Vec<String> = f.log.lines().iter().map(|l| plain(l)).collect();
    assert_eq!(lines.concat().matches('x').count(), 25);
    assert_eq!(lines[0], "x".repeat(25));
}

#[test]
fn pending_wrap_is_left_as_xterm_leaves_it() {
    let mut f = Fed::new(5, 3, 50);
    f.feed(&[b"abcde\x1b[DX", b"\r\n12345\x08Y"]);
    let text = f.screen_text();
    assert_eq!(
        text.split("\r\n").take(2).collect::<Vec<_>>(),
        ["abcXe", "123Y5"]
    );
}

#[test]
fn a_flood_keeps_its_last_lines_without_parsing_all_of_it() {
    let mut log = ScreenLog::new(80, 5, 1000);
    let mut at = 0u64;
    for j in 0..300u64 {
        let chunk: Vec<u8> = (0..1000)
            .flat_map(|i| format!("flood {:06}\r\n", j * 1000 + i).into_bytes())
            .collect();
        log.feed(at, &chunk, false);
        at += chunk.len() as u64;
    }
    log.drain();
    let history: Vec<String> = log.lines().iter().map(|l| plain(l)).collect();
    let expected: Vec<String> = (298_996..299_996)
        .map(|n| format!("flood {n:06}"))
        .collect();
    assert_eq!(history, expected);
}

#[test]
fn export_and_load_keep_a_full_screen_program_in_its_alternate_screen() {
    let mut f = Fed::new(30, 6, 50);
    f.feed(&[
        b"$ codex\r\n",
        b"\x1b[?1049h\x1b[H\x1b[2J",
        b"\x1b[1;1HOpenAI Codex",
        b"\x1b[4;1H\xe2\x80\xba \x1b[2mAsk Codex\x1b[0m",
        b"\x1b[6;1H  gpt low",
        b"\x1b[4;3H",
    ]);
    let state = f.log.export(true);
    let mut copy = Fed {
        log: ScreenLog::new(30, 6, 50),
        at: state.offset,
    };
    copy.log.load(&state);
    assert_eq!(copy.rows(), f.rows());
    assert_eq!(copy.rows()[0], "OpenAI Codex");
    assert_eq!(copy.log.rows_text_dim().cursor, (2, 3));
    assert_eq!(f.log.rows_text_dim().cursor, (2, 3));
    assert!(
        copy.log.rows_text_dim().rows[3][2].1,
        "the placeholder is still dim"
    );
    for target in [&mut f, &mut copy] {
        target.feed(&[b"\x1b[4;3Hhello", b"\x1b[?1049l"]);
    }
    assert_eq!(copy.rows(), f.rows());
    assert_eq!(copy.rows()[0], "$ codex");
    assert_eq!(copy.log.snapshot(50, b"").1, f.log.snapshot(50, b"").1);
}

#[test]
fn export_and_load_rebuild_the_same_history_and_screen() {
    let mut f = Fed::new(20, 4, 50);
    let mut out: Vec<u8> = (0..8)
        .flat_map(|i| format!("\x1b[2mline {i}\x1b[0m\r\n").into_bytes())
        .collect();
    out.extend(b"$ ");
    out.extend([b'y'; 30]);
    f.feed(&[&out]);
    let state = f.log.export(true);
    let mut copy = ScreenLog::new(20, 4, 50);
    copy.load(&state);
    assert_eq!(copy.lines(), f.log.lines());
    assert_eq!(copy.snapshot(50, b"").1, f.log.snapshot(50, b"").1);
    f.log.set_limit(3);
    assert_eq!(f.log.lines().len(), 3);
    assert_eq!(f.log.limit(), 3);
}

#[test]
fn an_export_is_the_json_python_writes() {
    let mut f = Fed::new(20, 4, 50);
    f.feed(&[
        "héllo \x1b[1;38;2;255;0;10mwörld\x1b[0m 😀\r\n\x1b[?1049h\"quoted\" \\ back".as_bytes(),
    ]);
    let state = f.log.export(true);
    let json = state.to_json();
    assert!(json.starts_with("{\"offset\":"), "{json}");
    assert!(
        json.contains("h\\u00e9llo")
            && json.contains("\\ud83d\\ude00")
            && json.contains("\\u001b[0;1;38;2;255;0;10m"),
        "{json}"
    );
    assert!(json.contains("\\\"quoted\\\" \\\\ back"), "{json}");
    assert_eq!(State::from_json(&json).unwrap(), state);
}
