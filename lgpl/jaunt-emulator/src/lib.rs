// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) Emeric Commenge for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! A terminal's own history and screen, as host/jaunt/screen.py keeps them (pyte 0.8.2 under it), for the Rust host.
//!
//! Each session runs this emulator off the event loop and keeps the last `limit` logical lines that left the top of the
//! normal screen (wrapped rows joined, serialized with their colors) and the screen itself: to hand a fresh view history
//! and screen as one short text ([`ScreenLog::snapshot`]), to give the rich view the screen as it shows
//! ([`ScreenLog::rows_text_dim`]), and to rebuild both after the host restarts ([`ScreenLog::export`], [`ScreenLog::load`]).
//!
//! It is a port, not a new emulator: the export must equal what the Python host's gives for the same output, quirks
//! included, for as long as Python can be a rollback target. The differential corpus (tests/fixtures/emulator in the jaunt
//! source, run through this library as the host loads it) holds the two to that.
//!
//! The host does not link this crate: it ships as a shared library (`crate-type = ["cdylib"]`, the C functions of [`ffi`],
//! versioned by [`ffi::ABI_VERSION`]) that the user may replace with a build of this source. The Rust types are here for the
//! tests and for any other program that wants the emulator.

mod cell;
mod charsets;
pub mod ffi;
mod parser;
mod screen;
pub mod state;
mod unicode;
mod unicode_table;

use std::collections::VecDeque;

pub use cell::{Attrs, Cell, Color, Text};
pub use screen::{Cursor, Fault, History};
pub use state::{ScreenState, State};
pub use unicode::width;

use parser::Parser;
use screen::{Buffer, Screen, DECAWM};

pub const HISTORY_LINES: usize = 10_000;
pub const LIMITS: [usize; 6] = [1_000, 5_000, 10_000, 20_000, 50_000, 100_000];
/// Output waiting for the emulator beyond which older waiting output is dropped: during a flood (a `cat` of a big file)
/// only the part holding the last `limit` lines is kept, since everything before it would leave the history anyway.
pub const BACKLOG: usize = 1024 * 1024;
/// Beyond this, whatever the lines, the emulator starts over from the latest output.
pub const HARD: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug)]
enum Pending {
    Data {
        offset: u64,
        data: Vec<u8>,
        alt: bool,
    },
    Size {
        cols: i64,
        rows: i64,
    },
    Capture(bool),
    Restart {
        offset: u64,
        cols: i64,
        rows: i64,
        alt: bool,
    },
}

/// The screen as it shows now (the alternate one while a full-screen program uses it), one `(text, dim)` per cell, with the
/// cursor: what the rich view reads (screen.py `ScreenRows`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenRows {
    pub rows: Vec<Vec<(Text, bool)>>,
    pub cursor: (i64, i64),
    pub cursor_hidden: bool,
    /// Hidden, with the program's own cursor (a reverse-video cell) on the cell where the real one is parked.
    pub cursor_drawn: bool,
}

impl ScreenRows {
    /// `{"rows":[[[cell texts],"dims"],...],"cursor":[x,y],"hidden":b,"drawn":b}`, written as Python's compact `json.dumps` would
    /// write the same values: each row holds its cells' texts and one `0`/`1` per cell for dim (a stub cell reads as a space).
    pub fn to_json(&self) -> String {
        let mut out = String::from("{\"rows\":[");
        for (y, row) in self.rows.iter().enumerate() {
            if y > 0 {
                out.push(',');
            }
            out.push_str("[[");
            let mut dims = String::with_capacity(row.len());
            for (x, (text, dim)) in row.iter().enumerate() {
                if x > 0 {
                    out.push(',');
                }
                state::json_str(&text.to_string_lossless(), &mut out);
                dims.push(if *dim { '1' } else { '0' });
            }
            out.push_str("],");
            state::json_str(&dims, &mut out);
            out.push(']');
        }
        let flag = |b: bool| if b { "true" } else { "false" };
        out.push_str(&format!(
            "],\"cursor\":[{},{}],\"hidden\":{},\"drawn\":{}}}",
            self.cursor.0,
            self.cursor.1,
            flag(self.cursor_hidden),
            flag(self.cursor_drawn)
        ));
        out
    }
}

/// History lines and screen of one session, fed in stream order (screen.py `ScreenLog`). Python's lock and worker thread
/// are the caller's here: `feed`, `resize` and `restore` only queue, [`ScreenLog::work`] consumes.
pub struct ScreenLog {
    screen: Screen,
    stream: Parser,
    /// Stream offset the emulator has consumed up to.
    pub offset: u64,
    pending: VecDeque<Pending>,
    /// Bytes waiting (Python's count: a restore queues output without counting it, so it can go below zero).
    backlog: i64,
    /// The producer side's latest size.
    pub cols: i64,
    pub rows: i64,
    /// Counts what the worker (or a load) did to the screen: a reader may keep what it worked out while it stays.
    pub changes: u64,
}

impl ScreenLog {
    pub fn new(cols: i64, rows: i64, lines: usize) -> ScreenLog {
        ScreenLog {
            screen: Screen::new(cols, rows, History::new(lines)),
            stream: Parser::default(),
            offset: 0,
            pending: VecDeque::new(),
            backlog: 0,
            cols,
            rows,
            changes: 0,
        }
    }

    fn renew(&mut self, cols: i64, rows: i64, alt: bool) {
        let history = std::mem::replace(&mut self.screen.history, History::new(0));
        self.screen = Screen::new(cols, rows, history);
        self.stream = Parser::default();
        if alt {
            let _ = self.screen.set_mode(&[1049], true); // entering the alternate screen cannot fail
        }
    }

    pub fn limit(&self) -> usize {
        self.screen.history.limit
    }

    pub fn set_limit(&mut self, lines: usize) {
        self.screen.history.set_limit(lines);
    }

    // --- producer side -------------------------------------------------------------------------------------------

    /// `alt`: whether the stream was in the alternate screen where `data` begins.
    pub fn feed(&mut self, offset: u64, data: &[u8], alt: bool) {
        self.pending.push_back(Pending::Data {
            offset,
            data: data.to_vec(),
            alt,
        });
        self.backlog += data.len() as i64;
        if self.backlog > BACKLOG as i64 {
            self.trim(offset + data.len() as u64, alt);
        }
    }

    /// Far behind (a flood): keep only the waiting output that holds the last `limit` lines.
    fn trim(&mut self, end: u64, alt: bool) {
        let need = self.screen.history.limit as i64 + self.rows;
        let mut kept = 0i64;
        for i in (0..self.pending.len()).rev() {
            let Pending::Data {
                offset,
                data,
                alt: item_alt,
            } = &self.pending[i]
            else {
                continue;
            };
            let count = memchr::memchr_iter(b'\n', data).count() as i64;
            if kept + count < need {
                kept += count;
                continue;
            }
            let mut cut = data.len();
            for _ in 0..need - kept {
                cut = memchr::memrchr(b'\n', &data[..cut]).expect("counted");
            }
            let (at, item_alt) = (offset + cut as u64 + 1, *item_alt);
            let tail = (cut + 1 < data.len()).then(|| data[cut + 1..].to_vec());
            let size = self
                .pending
                .range(..i)
                .fold(None, |size, older| match older {
                    Pending::Size { cols, rows } | Pending::Restart { cols, rows, .. } => {
                        Some((*cols, *rows))
                    }
                    _ => size,
                });
            let (cols, rows) = size.unwrap_or((self.screen.columns, self.screen.lines));
            let rest = self.pending.split_off(i + 1);
            self.pending = VecDeque::from([Pending::Restart {
                offset: at,
                cols,
                rows,
                alt: item_alt,
            }]);
            if let Some(data) = tail {
                self.pending.push_back(Pending::Data {
                    offset: at,
                    data,
                    alt: item_alt,
                });
            }
            self.pending.extend(rest);
            self.backlog = self
                .pending
                .iter()
                .map(|p| {
                    if let Pending::Data { data, .. } = p {
                        data.len() as i64
                    } else {
                        0
                    }
                })
                .sum();
            return;
        }
        if self.backlog > HARD as i64 {
            self.pending.clear();
            self.backlog = 0;
            self.pending.push_back(Pending::Restart {
                offset: end,
                cols: self.cols,
                rows: self.rows,
                alt,
            });
        }
    }

    pub fn resize(&mut self, cols: i64, rows: i64) {
        self.cols = cols;
        self.rows = rows;
        self.pending.push_back(Pending::Size { cols, rows });
    }

    /// After an in-place update: the history carried over, and the screen rebuilt from the retained output (`ring`: offset,
    /// bytes, cols, rows) without capturing its lines a second time (unless none were carried).
    pub fn restore(&mut self, history: Vec<String>, ring: &[(u64, Vec<u8>, i64, i64)]) {
        for line in history.iter() {
            self.screen.history.push(line.clone());
        }
        if let Some(first) = ring.first() {
            self.offset = first.0;
            if !history.is_empty() {
                self.pending.push_back(Pending::Capture(false));
            }
            for (n, data, cols, rows) in ring {
                if (*cols, *rows) != (self.screen.columns, self.screen.lines) {
                    self.pending.push_back(Pending::Size {
                        cols: *cols,
                        rows: *rows,
                    });
                }
                self.pending.push_back(Pending::Data {
                    offset: *n,
                    data: data.clone(),
                    alt: false,
                });
            }
            if !history.is_empty() {
                self.pending.push_back(Pending::Capture(true));
            }
        }
    }

    // --- consumer side -------------------------------------------------------------------------------------------

    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// Consume some pending output; true while more remains. Where Python raises, the screen starts over (with the
    /// history) and what was waiting is dropped, as screen.py's worker does.
    pub fn work(&mut self, budget: usize) -> bool {
        match self.work_inner(budget) {
            Ok(more) => more,
            Err(Fault) => {
                self.pending.clear();
                self.backlog = 0;
                self.renew(self.cols, self.rows, false);
                false
            }
        }
    }

    /// Everything waiting, consumed.
    pub fn drain(&mut self) {
        while self.work(64 * 1024) {}
    }

    fn work_inner(&mut self, budget: usize) -> Result<bool, Fault> {
        let mut done = 0;
        if !self.pending.is_empty() {
            self.changes += 1;
        }
        while done < budget {
            let Some(item) = self.pending.pop_front() else {
                break;
            };
            match item {
                Pending::Data { offset, data, alt } => {
                    self.backlog -= data.len() as i64;
                    if offset != self.offset {
                        // a gap: the screen is unknown, the history stays
                        self.renew(self.screen.columns, self.screen.lines, alt);
                    }
                    self.stream.feed(&mut self.screen, &data)?;
                    self.offset = offset + data.len() as u64;
                    done += data.len();
                }
                Pending::Size { cols, rows } => self.screen.resize(Some(rows), Some(cols)),
                Pending::Capture(on) => self.screen.capture = on,
                Pending::Restart {
                    offset,
                    cols,
                    rows,
                    alt,
                } => {
                    self.renew(cols, rows, alt);
                    self.offset = offset;
                }
            }
        }
        Ok(!self.pending.is_empty())
    }

    // --- readers -------------------------------------------------------------------------------------------------

    /// The last `lines` history lines then the screen, for a freshly reset terminal of that size, with `modes` (the
    /// termstate prefix) before the final cursor: `(offset, bytes, (cols, rows))`, the raw stream continuing from `offset`.
    pub fn snapshot(&mut self, lines: usize, modes: &[u8]) -> (u64, Vec<u8>, (i64, i64)) {
        let s = &mut self.screen;
        let mut out = String::new();
        if lines > 0 {
            let h = &s.history.lines;
            for text in h.iter().skip(h.len().saturating_sub(lines)) {
                out.push_str(text);
                out.push_str("\r\n");
            }
        }
        let (columns, height) = (s.columns, s.lines);
        let in_alt = s.main.is_some();
        {
            let (main_buffer, _) = match &mut s.main {
                Some((b, c)) => (b, c.clone()),
                None => (&mut s.buffer, s.cursor.clone()),
            };
            for y in 0..height {
                let line = main_buffer.row(y);
                let wrapped = line.wrapped && y < height - 1;
                out.push_str(&line.serialize(columns, !wrapped));
                if !wrapped && y < height - 1 {
                    out.push_str("\r\n");
                }
            }
        }
        if in_alt {
            // The normal screen is in place (with its cursor, saved as the program entered); the alternate screen goes on top.
            let main_cursor = s
                .main
                .as_ref()
                .map(|m| m.1.clone())
                .expect("in the alternate screen");
            out.push_str(&format!(
                "\x1b[{};{}H\x1b[?1049h",
                main_cursor.y + 1,
                main_cursor.x + 1
            ));
            for y in 0..height {
                out.push_str(&format!("\x1b[{};1H", y + 1));
                out.push_str(&s.buffer.row(y).serialize(columns, true));
            }
        }
        let mut data = out.into_bytes();
        data.extend_from_slice(modes);
        let cursor = &s.cursor;
        data.extend_from_slice(
            format!(
                "\x1b[{};{}H{}",
                cursor.y + 1,
                cursor.x.min(columns - 1) + 1,
                cursor.attrs.sgr()
            )
            .as_bytes(),
        );
        (self.offset, data, (columns, height))
    }

    /// The screen as it shows now, for the rich view's recognition of a program's prompt: what is on screen, never what an
    /// alternate screen hides.
    pub fn rows_text_dim(&mut self) -> ScreenRows {
        let s = &mut self.screen;
        let (columns, height) = (s.columns, s.lines);
        let mut rows = Vec::with_capacity(height.max(0) as usize);
        for y in 0..height {
            let line = s.buffer.row(y);
            rows.push(
                (0..columns)
                    .map(|x| {
                        let c = line.get(x);
                        let text = if c.text.is_stub() {
                            Text::One(' ')
                        } else {
                            c.text.clone()
                        };
                        (text, c.attrs.has(cell::DIM))
                    })
                    .collect::<Vec<_>>(),
            );
        }
        let (cx, cy) = (s.cursor.x, s.cursor.y);
        let hidden = s.cursor.hidden;
        let mut drawn = false;
        // Claude Code hides the terminal's cursor at its prompt and draws its own: the cell it is parked on in reverse
        // video. That cell is the cursor, not typed text.
        if hidden
            && 0 <= cy
            && cy < height
            && 0 <= cx
            && cx < columns
            && s.buffer.row(cy).get(cx).attrs.has(cell::REVERSE)
        {
            rows[cy as usize][cx as usize].1 = true;
            drawn = true;
        }
        ScreenRows {
            rows,
            cursor: (cx, cy),
            cursor_hidden: hidden,
            cursor_drawn: drawn,
        }
    }

    pub fn lines(&self) -> Vec<String> {
        self.screen.history.lines.iter().cloned().collect()
    }

    /// [`ScreenLog::lines`] as a JSON array of strings.
    pub fn lines_json(&self) -> String {
        let mut out = String::from("[");
        for (i, line) in self.screen.history.lines.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            state::json_str(line, &mut out);
        }
        out.push(']');
        out
    }

    /// History and screen, to rebuild this log after the host restarts: the normal screen, and the alternate one a
    /// full-screen program shows (`alt`). `history`: false leaves the lines out (the caller carries them).
    pub fn export(&mut self, history: bool) -> State {
        let s = &mut self.screen;
        let (columns, height) = (s.columns, s.lines);
        let screen_of = |buffer: &mut Buffer, cursor: &Cursor| -> ScreenState {
            let mut st = ScreenState {
                cursor: (cursor.x, cursor.y),
                hidden: cursor.hidden,
                ..Default::default()
            };
            for y in 0..height {
                let row = buffer.row(y);
                st.screen.push(row.serialize(columns, !row.wrapped));
            }
            for y in 0..height {
                st.wrapped.push(buffer.row(y).wrapped);
            }
            st
        };
        let main = match &mut s.main {
            Some((b, c)) => screen_of(b, &c.clone()),
            None => {
                let cursor = s.cursor.clone();
                screen_of(&mut s.buffer, &cursor)
            }
        };
        let alt = if s.main.is_some() {
            let cursor = s.cursor.clone();
            Some(screen_of(&mut s.buffer, &cursor))
        } else {
            None
        };
        State {
            offset: self.offset,
            cols: columns,
            rows: height,
            history: if history {
                s.history.lines.iter().cloned().collect()
            } else {
                Vec::new()
            },
            pending: s.pending.clone(),
            main,
            alt,
        }
    }

    /// The counterpart of [`ScreenLog::export`]: same history, same screen and cursor.
    pub fn load(&mut self, state: &State) {
        let (cols, rows) = (state.cols, state.rows);
        for line in &state.history {
            self.screen.history.push(line.clone());
        }
        self.renew(cols, rows, false);
        self.draw_state(&state.main, cols, rows);
        if let Some(alt) = &state.alt {
            let _ = self.screen.set_mode(&[1049], true); // the normal screen kept aside, as the program left it
            self.draw_state(alt, cols, rows);
        }
        self.screen.pending = state.pending.clone();
        self.offset = state.offset;
        self.cols = cols;
        self.rows = rows;
        self.changes += 1;
    }

    fn draw_state(&mut self, part: &ScreenState, cols: i64, rows: i64) {
        self.screen.capture = false;
        for (y, text) in part.screen.iter().take(rows.max(0) as usize).enumerate() {
            let y = y as i64;
            self.screen.cursor.x = 0;
            self.screen.cursor.y = y;
            self.screen.mode_discard(DECAWM);
            if self.stream.feed(&mut self.screen, text.as_bytes()).is_err() {
                // What export() writes never raises; a hand-made state that does leaves that row as far as it went.
                self.stream = Parser::default();
            }
            self.screen.mode_add(DECAWM);
            self.screen.buffer.row(y).wrapped =
                part.wrapped.get(y as usize).copied().unwrap_or(false);
        }
        self.screen.capture = true;
        self.screen.cursor.attrs = Attrs::PLAIN;
        let (x, y) = part.cursor;
        self.screen.cursor.x = x.min(cols).max(0);
        self.screen.cursor.y = y.min(rows - 1).max(0);
        self.screen.cursor.hidden = part.hidden;
    }

    /// The emulated screen's size.
    pub fn size(&self) -> (i64, i64) {
        (self.screen.columns, self.screen.lines)
    }
}

#[cfg(test)]
mod tests;
