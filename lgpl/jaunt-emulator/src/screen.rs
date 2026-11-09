// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) Emeric Commenge for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! The screen: pyte 0.8.2's `Screen` with host/jaunt/screen.py's `_Screen` over it, operation for operation.
//!
//! What a screen holds and how every operation changes it follows the Python code, quirks included, because the Python host
//! is still a rollback target and the rich view reads these screens: rows and cells exist only once something wrote or read
//! them (pyte's dicts), and that matters (erasing the display rewrites the present cells only; deleting lines leaves a row
//! whose replacement was never touched as it was); a cursor can stand past the last column or below the last row; and the
//! operations Python raises on (a cursor-to-line in origin mode without margins, an erase of an unknown kind, too many
//! parameters, a number of more than 4300 digits) return [`Fault`], after which the log starts its screen over as the
//! Python worker does.

use std::collections::{BTreeSet, HashSet, VecDeque};

use super::cell::{self, Attrs, Cell, Row, Text, BLANK};
use super::charsets;
use super::unicode::{self, PLAIN};

pub(crate) const LNM: i64 = 20;
pub(crate) const IRM: i64 = 4;
pub(crate) const DECTCEM: i64 = 25 << 5;
pub(crate) const DECSCNM: i64 = 5 << 5;
pub(crate) const DECOM: i64 = 6 << 5;
pub(crate) const DECAWM: i64 = 7 << 5;
pub(crate) const DECCOLM: i64 = 3 << 5;
const ALT: [i64; 3] = [47, 1047, 1049];

/// What Python raises on: the log starts the screen over (screen.py `_Worker._run`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fault;

/// The history: the last `limit` logical lines that left the top of the normal screen (a bounded `deque`).
#[derive(Clone, Debug)]
pub struct History {
    pub(crate) lines: VecDeque<String>,
    pub(crate) limit: usize,
}

impl History {
    pub fn new(limit: usize) -> History {
        History {
            lines: VecDeque::new(),
            limit,
        }
    }

    pub(crate) fn push(&mut self, line: String) {
        if self.limit == 0 {
            return;
        }
        if self.lines.len() >= self.limit {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    pub(crate) fn set_limit(&mut self, limit: usize) {
        while self.lines.len() > limit {
            self.lines.pop_front();
        }
        self.limit = limit;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Charset {
    Latin1,
    Vt100,
    Ibmpc,
    Vax42,
}

impl Charset {
    fn of(code: char) -> Option<Charset> {
        match code {
            'B' => Some(Charset::Latin1),
            '0' => Some(Charset::Vt100),
            'U' => Some(Charset::Ibmpc),
            'V' => Some(Charset::Vax42),
            _ => None,
        }
    }

    fn translate(self, ch: char) -> char {
        let table = match self {
            Charset::Latin1 => return ch,
            Charset::Vt100 => &charsets::VT100,
            Charset::Ibmpc => &charsets::IBMPC,
            Charset::Vax42 => &charsets::VAX42,
        };
        match table.get(ch as usize) {
            Some(&v) => char::from_u32(v as u32).unwrap_or(ch),
            None => ch,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cursor {
    pub x: i64,
    pub y: i64,
    pub attrs: Attrs,
    pub hidden: bool,
}

impl Cursor {
    fn new(x: i64, y: i64, attrs: Attrs) -> Cursor {
        Cursor {
            x,
            y,
            attrs,
            hidden: false,
        }
    }
}

#[derive(Clone, Debug)]
struct Savepoint {
    cursor: Cursor,
    g0: Charset,
    g1: Charset,
    charset: u8,
    origin: bool,
    wrap: bool,
}

/// pyte's `defaultdict` of rows: reading a row through it makes it exist.
#[derive(Clone, Debug, Default)]
pub struct Buffer {
    rows: Vec<Option<Row>>,
}

impl Buffer {
    /// `buffer[y]`: the row, made if it was not there.
    pub(crate) fn row(&mut self, y: i64) -> &mut Row {
        let y = y.max(0) as usize;
        if y >= self.rows.len() {
            self.rows.resize_with(y + 1, || None);
        }
        self.rows[y].get_or_insert_with(Row::default)
    }

    pub(crate) fn contains(&self, y: i64) -> bool {
        y >= 0 && matches!(self.rows.get(y as usize), Some(Some(_)))
    }

    pub(crate) fn pop(&mut self, y: i64) -> Option<Row> {
        if y < 0 {
            return None;
        }
        self.rows.get_mut(y as usize).and_then(Option::take)
    }

    /// `buffer[y] = row`.
    pub(crate) fn put(&mut self, y: i64, row: Row) {
        *self.row(y) = row;
    }

    /// `buffer[to] = buffer[from]` followed, in every caller, by the source key being reassigned or popped: a move.
    fn shift(&mut self, to: i64, from: i64) {
        self.row(from);
        let row = self.pop(from).unwrap_or_default();
        self.put(to, row);
    }

    pub(crate) fn clear(&mut self) {
        self.rows.clear();
    }

    fn present_mut(&mut self) -> impl Iterator<Item = &mut Row> {
        self.rows.iter_mut().flatten()
    }
}

pub struct Screen {
    pub columns: i64,
    pub lines: i64,
    pub buffer: Buffer,
    pub cursor: Cursor,
    savepoints: Vec<Savepoint>,
    mode: HashSet<i64>,
    margins: Option<(i64, i64)>,
    charset: u8,
    g0: Charset,
    g1: Charset,
    tabstops: BTreeSet<i64>,
    saved_columns: Option<i64>,
    // screen.py's _Screen
    pub history: History,
    /// A logical line whose rows scrolled off but continue below.
    pub pending: String,
    pub capture: bool,
    /// The normal screen and its cursor while the alternate one shows.
    pub main: Option<(Buffer, Cursor)>,
    /// Grapheme state of the last printed character (xterm's precedingJoinState).
    pub(crate) join: u32,
    last: String,
}

fn default_mode() -> HashSet<i64> {
    HashSet::from([DECAWM, DECTCEM])
}

/// `count or 1`.
fn or1(v: Option<i64>) -> i64 {
    match v {
        Some(0) | None => 1,
        Some(n) => n,
    }
}

impl Screen {
    pub fn new(columns: i64, lines: i64, history: History) -> Screen {
        let mut s = Screen {
            columns,
            lines,
            buffer: Buffer::default(),
            cursor: Cursor::new(0, 0, Attrs::PLAIN),
            savepoints: Vec::new(),
            mode: default_mode(),
            margins: None,
            charset: 0,
            g0: Charset::Latin1,
            g1: Charset::Vt100,
            tabstops: BTreeSet::new(),
            saved_columns: None,
            history,
            pending: String::new(),
            capture: true,
            main: None,
            join: 0,
            last: String::new(),
        };
        s.reset();
        s
    }

    pub(crate) fn has_mode(&self, mode: i64) -> bool {
        self.mode.contains(&mode)
    }

    pub(crate) fn mode_add(&mut self, mode: i64) {
        self.mode.insert(mode);
    }

    pub(crate) fn mode_discard(&mut self, mode: i64) {
        self.mode.remove(&mode);
    }

    fn region(&self) -> (i64, i64) {
        self.margins.unwrap_or((0, self.lines - 1))
    }

    // --- pyte Screen ---------------------------------------------------------------------------------------------

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.margins = None;
        self.mode = default_mode();
        self.charset = 0;
        self.g0 = Charset::Latin1;
        self.g1 = Charset::Vt100;
        self.tabstops = (8..self.columns.max(8)).step_by(8).collect();
        self.cursor = Cursor::new(0, 0, Attrs::PLAIN);
        self.cursor_position(None, None);
        self.saved_columns = None;
        // _Screen.reset
        self.cursor.attrs = Attrs::PLAIN;
        self.join = 0;
        self.last.clear();
    }

    pub(crate) fn set_margins(&mut self, top: Option<i64>, bottom: Option<i64>) {
        if matches!(top, None | Some(0)) && bottom.is_none() {
            self.margins = None;
            return;
        }
        let (mtop, mbottom) = self.region();
        let top = match top {
            None => mtop,
            Some(t) => 0.max((t - 1).min(self.lines - 1)),
        };
        let bottom = match bottom {
            None => mbottom,
            Some(b) => 0.max((b - 1).min(self.lines - 1)),
        };
        if bottom - top >= 1 {
            self.margins = Some((top, bottom));
            self.cursor_position(None, None);
        }
    }

    fn base_set_mode(&mut self, modes: &[i64], private: bool) -> Result<(), Fault> {
        let list: Vec<i64> = if private {
            modes.iter().map(|m| m << 5).collect()
        } else {
            modes.to_vec()
        };
        self.mode.extend(list.iter().copied());
        if list.contains(&DECCOLM) {
            self.saved_columns = Some(self.columns);
            self.resize(None, Some(132));
            self.erase_in_display(2)?;
            self.cursor_position(None, None);
        }
        if list.contains(&DECOM) {
            self.cursor_position(None, None);
        }
        if list.contains(&DECSCNM) {
            for row in self.buffer.present_mut() {
                row.rewrite_present(|c| {
                    let mut c = c.clone();
                    c.attrs.set(cell::REVERSE, true);
                    c
                });
            }
            self.cursor.attrs.set(cell::REVERSE, true); // select_graphic_rendition(7)
        }
        if list.contains(&DECTCEM) {
            self.cursor.hidden = false;
        }
        Ok(())
    }

    fn base_reset_mode(&mut self, modes: &[i64], private: bool) -> Result<(), Fault> {
        let list: Vec<i64> = if private {
            modes.iter().map(|m| m << 5).collect()
        } else {
            modes.to_vec()
        };
        for m in &list {
            self.mode.remove(m);
        }
        if list.contains(&DECCOLM) {
            if self.columns == 132 {
                if let Some(saved) = self.saved_columns {
                    self.resize(None, Some(saved));
                    self.saved_columns = None;
                }
            }
            self.erase_in_display(2)?;
            self.cursor_position(None, None);
        }
        if list.contains(&DECOM) {
            self.cursor_position(None, None);
        }
        if list.contains(&DECSCNM) {
            for row in self.buffer.present_mut() {
                row.rewrite_present(|c| {
                    let mut c = c.clone();
                    c.attrs.set(cell::REVERSE, false);
                    c
                });
            }
            self.cursor.attrs.set(cell::REVERSE, false); // select_graphic_rendition(27)
        }
        if list.contains(&DECTCEM) {
            self.cursor.hidden = true;
        }
        Ok(())
    }

    pub(crate) fn define_charset(&mut self, code: char, mode: char) {
        if let Some(set) = Charset::of(code) {
            if mode == '(' {
                self.g0 = set;
            } else if mode == ')' {
                self.g1 = set;
            }
        }
    }

    pub(crate) fn shift_in(&mut self) {
        self.charset = 0;
    }

    pub(crate) fn shift_out(&mut self) {
        self.charset = 1;
    }

    pub(crate) fn carriage_return(&mut self) {
        self.cursor.x = 0;
    }

    fn base_index(&mut self) {
        let (top, bottom) = self.region();
        if self.cursor.y == bottom {
            for y in top..bottom {
                self.buffer.shift(y, y + 1);
            }
            self.buffer.pop(bottom);
        } else {
            self.cursor_down(None);
        }
    }

    pub(crate) fn reverse_index(&mut self) {
        let (top, bottom) = self.region();
        if self.cursor.y == top {
            let mut y = bottom;
            while y > top {
                self.buffer.shift(y, y - 1);
                y -= 1;
            }
            self.buffer.pop(top);
        } else {
            self.cursor_up(None);
        }
    }

    pub(crate) fn tab(&mut self) {
        let x = self.cursor.x;
        self.cursor.x = self
            .tabstops
            .range(x + 1..)
            .next()
            .copied()
            .unwrap_or(self.columns - 1);
    }

    pub(crate) fn save_cursor(&mut self) {
        self.savepoints.push(Savepoint {
            cursor: self.cursor.clone(),
            g0: self.g0,
            g1: self.g1,
            charset: self.charset,
            origin: self.has_mode(DECOM),
            wrap: self.has_mode(DECAWM),
        });
    }

    pub(crate) fn restore_cursor(&mut self) -> Result<(), Fault> {
        if let Some(sp) = self.savepoints.pop() {
            self.g0 = sp.g0;
            self.g1 = sp.g1;
            self.charset = sp.charset;
            if sp.origin {
                self.set_mode(&[DECOM], false)?;
            }
            if sp.wrap {
                self.set_mode(&[DECAWM], false)?;
            }
            self.cursor = sp.cursor;
            self.ensure_hbounds();
            self.ensure_vbounds(true);
        } else {
            self.reset_mode(&[DECOM], false)?;
            self.cursor_position(None, None);
        }
        Ok(())
    }

    pub(crate) fn insert_lines(&mut self, count: Option<i64>) {
        let count = or1(count);
        let (top, bottom) = self.region();
        if top <= self.cursor.y && self.cursor.y <= bottom {
            let mut y = bottom;
            while y >= self.cursor.y {
                if y + count <= bottom && self.buffer.contains(y) {
                    let row = self.buffer.pop(y).unwrap_or_default();
                    self.buffer.put(y + count, row);
                }
                self.buffer.pop(y);
                y -= 1;
            }
            self.carriage_return();
        }
    }

    pub(crate) fn delete_lines(&mut self, count: Option<i64>) {
        let count = or1(count);
        let (top, bottom) = self.region();
        if top <= self.cursor.y && self.cursor.y <= bottom {
            for y in self.cursor.y..=bottom {
                if y + count <= bottom {
                    if self.buffer.contains(y + count) {
                        let row = self.buffer.pop(y + count).unwrap_or_default();
                        self.buffer.put(y, row);
                    }
                } else {
                    self.buffer.pop(y);
                }
            }
            self.carriage_return();
        }
    }

    pub(crate) fn insert_characters(&mut self, count: Option<i64>) {
        let count = or1(count);
        let (columns, cx) = (self.columns, self.cursor.x);
        let line = self.buffer.row(self.cursor.y);
        let mut x = columns;
        while x > cx - 1 {
            if x + count <= columns {
                let cell = line.get(x).clone();
                line.set(x + count, cell);
            }
            line.pop(x);
            x -= 1;
        }
    }

    pub(crate) fn delete_characters(&mut self, count: Option<i64>) {
        let count = or1(count);
        let (columns, cx) = (self.columns, self.cursor.x);
        let line = self.buffer.row(self.cursor.y);
        for x in cx..columns {
            if x + count <= columns {
                let cell = line.pop(x + count).unwrap_or_else(|| BLANK.clone());
                line.set(x, cell);
            } else {
                line.pop(x);
            }
        }
    }

    pub(crate) fn erase_characters(&mut self, count: Option<i64>) {
        let count = or1(count);
        let (columns, cx, attrs) = (self.columns, self.cursor.x, self.cursor.attrs);
        let line = self.buffer.row(self.cursor.y);
        for x in cx..(cx + count).min(columns) {
            line.set(x, Cell::blank(attrs));
        }
    }

    fn base_erase_in_line(&mut self, how: i64) -> Result<(), Fault> {
        let (columns, cx, attrs) = (self.columns, self.cursor.x, self.cursor.attrs);
        let range = match how {
            0 => cx..columns,
            1 => 0..cx + 1,
            2 => 0..columns,
            _ => {
                self.buffer.row(self.cursor.y); // made before Python's UnboundLocalError
                return Err(Fault);
            }
        };
        let line = self.buffer.row(self.cursor.y);
        for x in range {
            line.set(x, Cell::blank(attrs));
        }
        Ok(())
    }

    fn base_erase_in_display(&mut self, how: i64) -> Result<(), Fault> {
        let range = match how {
            0 => self.cursor.y + 1..self.lines,
            1 => 0..self.cursor.y,
            2 | 3 => 0..self.lines,
            _ => return Err(Fault),
        };
        let attrs = self.cursor.attrs;
        for y in range {
            self.buffer.row(y).rewrite_present(|_| Cell::blank(attrs));
        }
        if how == 0 || how == 1 {
            self.erase_in_line(how)?;
        }
        Ok(())
    }

    pub(crate) fn set_tab_stop(&mut self) {
        self.tabstops.insert(self.cursor.x);
    }

    pub(crate) fn clear_tab_stop(&mut self, how: Option<i64>) {
        match how.unwrap_or(0) {
            0 => {
                self.tabstops.remove(&self.cursor.x);
            }
            3 => self.tabstops.clear(),
            _ => {}
        }
    }

    fn ensure_hbounds(&mut self) {
        self.cursor.x = self.cursor.x.max(0).min(self.columns - 1);
    }

    fn ensure_vbounds(&mut self, use_margins: bool) {
        let (top, bottom) = match self.margins {
            Some(m) if use_margins || self.has_mode(DECOM) => m,
            _ => (0, self.lines - 1),
        };
        self.cursor.y = self.cursor.y.max(top).min(bottom);
    }

    pub(crate) fn cursor_up(&mut self, count: Option<i64>) {
        let (top, _) = self.region();
        self.cursor.y = (self.cursor.y - or1(count)).max(top);
    }

    pub(crate) fn cursor_up1(&mut self, count: Option<i64>) {
        self.cursor_up(count);
        self.carriage_return();
    }

    pub(crate) fn cursor_down(&mut self, count: Option<i64>) {
        let (_, bottom) = self.region();
        self.cursor.y = (self.cursor.y + or1(count)).min(bottom);
    }

    pub(crate) fn cursor_down1(&mut self, count: Option<i64>) {
        self.cursor_down(count);
        self.carriage_return();
    }

    pub(crate) fn cursor_back(&mut self, count: Option<i64>) {
        if self.cursor.x == self.columns {
            self.cursor.x -= 1;
        }
        self.cursor.x -= or1(count);
        self.ensure_hbounds();
    }

    pub(crate) fn cursor_forward(&mut self, count: Option<i64>) {
        self.cursor.x += or1(count);
        self.ensure_hbounds();
    }

    pub(crate) fn cursor_position(&mut self, line: Option<i64>, column: Option<i64>) {
        let column = or1(column) - 1;
        let mut line = or1(line) - 1;
        if let Some((top, bottom)) = self.margins {
            if self.has_mode(DECOM) {
                line += top;
                if !(top <= line && line <= bottom) {
                    return;
                }
            }
        }
        self.cursor.x = column;
        self.cursor.y = line;
        self.ensure_hbounds();
        self.ensure_vbounds(false);
    }

    pub(crate) fn cursor_to_column(&mut self, column: Option<i64>) {
        self.cursor.x = or1(column) - 1;
        self.ensure_hbounds();
    }

    pub(crate) fn cursor_to_line(&mut self, line: Option<i64>) -> Result<(), Fault> {
        self.cursor.y = or1(line) - 1;
        if self.has_mode(DECOM) {
            let (top, _) = self.margins.ok_or(Fault)?; // pyte asserts margins here
            self.cursor.y += top;
        }
        self.ensure_vbounds(false);
        Ok(())
    }

    pub(crate) fn alignment_display(&mut self) {
        for y in 0..self.lines {
            let line = self.buffer.row(y);
            for x in 0..self.columns {
                let attrs = line.get(x).attrs;
                line.set(
                    x,
                    Cell {
                        text: Text::One('E'),
                        attrs,
                    },
                );
            }
        }
    }

    // --- screen.py _Screen -------------------------------------------------------------------------------------

    fn push(&mut self, row_text: Option<String>, wrapped: bool, force: bool) {
        if !self.capture || (self.main.is_some() && !force) {
            return;
        }
        let text = self.pending.clone() + &row_text.unwrap_or_default();
        if wrapped {
            self.pending = text;
        } else {
            self.pending.clear();
            self.history.push(text);
        }
    }

    /// `_push(line)`: serialized only when it is kept.
    fn push_row(&mut self, y: i64, force: bool) {
        if !self.capture || (self.main.is_some() && !force) {
            self.buffer.row(y);
            return;
        }
        let columns = self.columns;
        let row = self.buffer.row(y);
        let wrapped = row.wrapped;
        let text = row.serialize(columns, !wrapped);
        self.push(Some(text), wrapped, force);
    }

    /// `draw`: printing, as xterm.js InputHandler.print.
    pub(crate) fn draw(&mut self, data: &str) {
        let set = if self.charset != 0 { self.g1 } else { self.g0 };
        let cols = self.columns;
        let wrap = self.has_mode(DECAWM);
        let insert = self.has_mode(IRM);
        let attrs = self.cursor.attrs;
        {
            let cx = self.cursor.x;
            let line = self.buffer.row(self.cursor.y);
            if 0 < cx
                && cx < cols
                && line.get(cx).text.is_stub()
                && !line.get(cx - 1).text.is_stub()
            {
                line.set(cx - 1, Cell::blank(attrs)); // overwriting the second half of a wide character
            }
        }
        let mut state = self.join;
        let stub = Cell {
            text: Text::Stub,
            attrs,
        };
        let ascii_after = unicode::properties(0x41, unicode::properties(0xE9, 0));
        for ch in data.chars().map(|c| set.translate(c)) {
            if (' '..='~').contains(&ch) && (state >> 3) & 15 != 1 {
                // ASCII never joins what precedes it, unless that is a Prepend character.
                state = if state >> 3 == 0 { PLAIN } else { ascii_after };
                if self.cursor.x >= cols {
                    if !wrap {
                        self.cursor.x = cols - 1;
                    } else {
                        self.buffer.row(self.cursor.y).wrapped = true;
                        self.cursor.x = 0;
                        self.index();
                    }
                }
                if insert {
                    self.insert_characters(Some(1));
                }
                let x = self.cursor.x;
                self.buffer.row(self.cursor.y).set(
                    x,
                    Cell {
                        text: Text::One(ch),
                        attrs,
                    },
                );
                self.last.clear();
                self.last.push(ch);
                self.cursor.x += 1;
                continue;
            }
            let props = unicode::properties(ch as u32, state);
            let w = ((props >> 1) & 3) as i64;
            let join = props & 1 != 0;
            let old = if join { ((state >> 1) & 3) as i64 } else { 0 };
            state = props;
            if self.cursor.x + w - old > cols {
                if wrap {
                    let py = self.cursor.y;
                    let col = self.cursor.x - old;
                    let moved: Vec<Cell> = {
                        let prev = self.buffer.row(py);
                        prev.wrapped = true;
                        (0..old).map(|i| prev.get(col + i).clone()).collect()
                    };
                    // Where the row being left is once the line feed has scrolled (or not).
                    let (top, bottom) = self.region();
                    let prev_at = if py == bottom {
                        if bottom > top {
                            Some(py - 1)
                        } else {
                            None
                        }
                    } else {
                        Some(py)
                    };
                    self.cursor.x = old;
                    self.index();
                    let line = self.buffer.row(self.cursor.y);
                    for (i, cell) in moved.into_iter().enumerate() {
                        line.set(i as i64, cell);
                    }
                    if let Some(py) = prev_at {
                        let prev = self.buffer.row(py);
                        for x in col..cols {
                            prev.set(x, Cell::blank(attrs));
                        }
                    }
                } else {
                    self.cursor.x = cols - 1;
                    if w == 2 {
                        continue;
                    }
                }
            }
            if join && self.cursor.x != 0 {
                let cx = self.cursor.x;
                let line = self.buffer.row(self.cursor.y);
                let at = cx
                    - if !line.get(cx - 1).text.is_stub() {
                        1
                    } else {
                        2
                    };
                let cell = line.get(at);
                let joined = Cell {
                    text: cell.text.joined(ch),
                    attrs: cell.attrs,
                };
                self.last = joined.text.to_string_lossless();
                line.set(at, joined);
                for _ in 0..(w - old).max(0) {
                    line.set(self.cursor.x, stub.clone());
                    self.cursor.x += 1;
                }
                continue;
            }
            if insert {
                self.insert_characters(Some(w - old));
            }
            let x = self.cursor.x;
            let line = self.buffer.row(self.cursor.y);
            line.set(
                x,
                Cell {
                    text: Text::One(ch),
                    attrs,
                },
            );
            self.last.clear();
            self.last.push(ch);
            self.cursor.x += 1;
            for _ in 0..(w - 1).max(0) {
                line.set(self.cursor.x, stub.clone());
                self.cursor.x += 1;
            }
        }
        self.join = state;
        let cx = self.cursor.x;
        let line = self.buffer.row(self.cursor.y);
        if cx < cols && line.get(cx).text.is_stub() {
            line.set(cx, Cell::blank(attrs));
        }
    }

    pub(crate) fn repeat(&mut self, count: i64) {
        if self.join != 0 && !self.last.is_empty() {
            let join = self.join;
            let text = self.last.repeat(count.max(1) as usize);
            self.draw(&text);
            self.join = join;
        }
    }

    pub(crate) fn index(&mut self) {
        let (top, bottom) = self.region();
        if self.cursor.y == bottom && top == 0 {
            self.push_row(0, false);
        }
        self.base_index();
    }

    pub(crate) fn linefeed(&mut self) {
        self.buffer.row(self.cursor.y).wrapped = false; // an explicit new line ends the logical line
        self.index();
        if self.has_mode(LNM) {
            self.carriage_return();
        }
        if self.cursor.x >= self.columns {
            self.cursor.x = self.columns - 1;
        }
    }

    pub(crate) fn backspace(&mut self) {
        self.cursor.x = self.cursor.x.min(self.columns - 1);
        if self.cursor.x > 0 {
            self.cursor.x -= 1;
        }
    }

    /// SU/SD: the region scrolls without moving the cursor; xterm keeps no scrollback here.
    pub(crate) fn scroll(&mut self, count: i64, up: bool) {
        let (top, bottom) = self.region();
        for _ in 0..count.max(1).min(bottom - top + 1) {
            if up {
                for y in top..bottom {
                    self.buffer.shift(y, y + 1);
                }
                self.buffer.pop(bottom);
            } else {
                let mut y = bottom;
                while y > top {
                    self.buffer.shift(y, y - 1);
                    y -= 1;
                }
                self.buffer.pop(top);
            }
        }
    }

    pub(crate) fn tabs(&mut self, count: i64, forward: bool) {
        for _ in 0..count.max(1) {
            if forward {
                self.tab();
            } else {
                self.cursor.x = self
                    .tabstops
                    .range(..self.cursor.x)
                    .next_back()
                    .copied()
                    .unwrap_or(0);
            }
        }
    }

    pub(crate) fn erase_in_line(&mut self, how: i64) -> Result<(), Fault> {
        if how == 2 || (how == 0 && self.cursor.x == 0) {
            self.buffer.row(self.cursor.y).wrapped = false; // the row is rewritten from its start
        }
        self.base_erase_in_line(how)
    }

    pub(crate) fn erase_in_display(&mut self, how: i64) -> Result<(), Fault> {
        if how == 3 {
            // clear the scrollback, as xterm does
            self.history.lines.clear();
            self.pending.clear();
            return Ok(());
        }
        self.base_erase_in_display(how)
    }

    pub(crate) fn set_mode(&mut self, modes: &[i64], private: bool) -> Result<(), Fault> {
        let mut modes = modes.to_vec();
        if private {
            // 132 columns and reverse video change what xterm displays, not the cells.
            modes.retain(|m| *m != 3 && *m != 5);
            if modes.iter().any(|m| ALT.contains(m)) && self.main.is_none() {
                let cursor = Cursor::new(self.cursor.x, self.cursor.y, self.cursor.attrs);
                let cursor = std::mem::replace(&mut self.cursor, cursor);
                let buffer = std::mem::take(&mut self.buffer);
                self.main = Some((buffer, cursor));
            }
        }
        self.base_set_mode(&modes, private)
    }

    pub(crate) fn reset_mode(&mut self, modes: &[i64], private: bool) -> Result<(), Fault> {
        let mut modes = modes.to_vec();
        if private {
            modes.retain(|m| *m != 3 && *m != 5);
            if modes.iter().any(|m| ALT.contains(m)) {
                if let Some((buffer, cursor)) = self.main.take() {
                    self.buffer = buffer;
                    self.cursor = cursor;
                }
            }
        }
        self.base_reset_mode(&modes, private)
    }

    /// DECSTR: attributes, margins, insert and origin modes; the screen stays.
    pub(crate) fn soft_reset(&mut self) {
        self.cursor.attrs = Attrs::PLAIN;
        self.cursor.hidden = false;
        self.mode.remove(&IRM);
        self.mode.remove(&DECOM);
        self.mode.insert(DECAWM);
        self.margins = None;
        self.charset = 0;
    }

    // --- resizing: xterm reflows the normal screen at a new width ------------------------------------------------

    /// `_reflow`: the rows of `buffer` (with its cursor) rewrapped at `columns`. The rows that no longer fit go to the history,
    /// serialized at the old width as Python does.
    fn reflow(&mut self, in_main: bool, columns: i64) {
        let (rows, old_columns) = (self.lines, self.columns);
        let (mut buffer, mut cursor) = if in_main {
            self.main.take().expect("a normal screen kept aside")
        } else {
            (std::mem::take(&mut self.buffer), self.cursor.clone())
        };
        let mut logical: Vec<Vec<Cell>> = Vec::new();
        let mut cells: Vec<Cell> = Vec::new();
        let mut mark: Option<(usize, i64)> = None;
        for y in 0..rows {
            let row = buffer.row(y);
            let wrapped = row.wrapped && y < rows - 1;
            let mut n = old_columns;
            if !wrapped {
                while n > 0 && row.get(n - 1).is_blank() {
                    n -= 1;
                }
            }
            if y == cursor.y {
                let x = cursor.x.min(old_columns);
                mark = Some((logical.len(), cells.len() as i64 + x));
                n = n.max(x);
            }
            cells.extend((0..n).map(|x| row.get(x).clone()));
            if !wrapped {
                logical.push(std::mem::take(&mut cells));
            }
        }
        if !cells.is_empty() {
            logical.push(cells);
        }
        let mut end = mark.map_or(0, |m| m.0);
        for (i, l) in logical.iter().enumerate() {
            if !l.is_empty() {
                end = end.max(i);
            }
        }
        let mut out: Vec<Row> = Vec::new();
        let mut place = (0i64, 0i64);
        for (i, cells) in logical.iter().enumerate().take(end + 1) {
            let mut row = Row::default();
            let mut x = 0i64;
            for (j, cell) in cells.iter().enumerate() {
                if cell.text.is_stub() && j > 0 {
                    continue; // a wide character's second half follows it
                }
                let w = if j + 1 < cells.len() && cells[j + 1].text.is_stub() {
                    2
                } else {
                    1
                };
                if x + w > columns {
                    row.wrapped = true;
                    out.push(std::mem::take(&mut row));
                    x = 0;
                }
                if mark == Some((i, j as i64)) {
                    place = (out.len() as i64, x);
                }
                row.set(x, cell.clone());
                if w == 2 {
                    row.set(x + 1, cells[j + 1].clone());
                }
                x += w;
            }
            if let Some((mi, mj)) = mark {
                if mi == i && mj >= cells.len() as i64 {
                    place = (out.len() as i64, columns.min(x + mj - cells.len() as i64));
                }
            }
            out.push(row);
        }
        let excess = 0.max(out.len() as i64 - rows).max(place.0 - rows + 1);
        let mut out = out.into_iter();
        for _ in 0..excess {
            if let Some(row) = out.next() {
                if self.capture {
                    let text = row.serialize(old_columns, !row.wrapped);
                    self.push(Some(text), row.wrapped, true);
                }
            }
        }
        buffer.clear();
        for (y, row) in out.take(rows.max(0) as usize).enumerate() {
            buffer.put(y as i64, row);
        }
        cursor.y = 0.max(place.0 - excess);
        cursor.x = place.1;
        if in_main {
            self.main = Some((buffer, cursor));
        } else {
            self.buffer = buffer;
            self.cursor = cursor;
        }
    }

    fn base_resize(&mut self, lines: i64, columns: i64) {
        if lines == self.lines && columns == self.columns {
            return;
        }
        if lines < self.lines {
            self.save_cursor();
            self.cursor_position(Some(0), Some(0));
            self.delete_lines(Some(self.lines - lines));
            let _ = self.restore_cursor(); // a savepoint was just pushed: no mode change can fail here
        }
        if columns < self.columns {
            let old = self.columns;
            for row in self.buffer.present_mut() {
                row.truncate(columns, old);
            }
        }
        self.lines = lines;
        self.columns = columns;
        self.set_margins(None, None);
    }

    pub fn resize(&mut self, lines: Option<i64>, columns: Option<i64>) {
        let lines = match lines {
            Some(0) | None => self.lines,
            Some(n) => n,
        };
        let columns = match columns {
            Some(0) | None => self.columns,
            Some(n) => n,
        };
        if columns != self.columns {
            let in_main = self.main.is_some();
            self.reflow(in_main, columns);
        }
        if lines < self.lines && self.main.is_none() {
            // As xterm does: rows that no longer fit above the cursor go to the history.
            let push = 0.max(self.cursor.y - (lines - 1));
            for y in 0..push {
                self.push_row(y, false);
            }
            if push > 0 {
                for y in 0..self.lines - push {
                    self.buffer.shift(y, y + push);
                }
                for y in self.lines - push..self.lines {
                    self.buffer.pop(y);
                }
                self.cursor.y -= push;
            }
            for y in lines..self.lines {
                self.buffer.pop(y);
            }
            self.lines = lines;
        }
        self.base_resize(lines, columns);
        self.cursor.x = self.cursor.x.min(columns);
    }

    pub(crate) fn sgr(&mut self, params: &str) -> Result<(), Fault> {
        let parts: Vec<&str> = if params.is_empty() {
            vec!["0"]
        } else {
            params.split(';').collect()
        };
        let mut change = self.cursor.attrs;
        let mut changed = false;
        let mut i = 0;
        while i < parts.len() {
            let sub: Vec<&str> = parts[i].split(':').collect();
            i += 1;
            if !is_digits(sub[0]) && !sub[0].is_empty() {
                continue;
            }
            let n = int(if sub[0].is_empty() { "0" } else { sub[0] })?;
            changed = true;
            match n.value {
                Some(0) => change = Attrs::PLAIN,
                Some(code @ (38 | 48 | 58)) => {
                    let mut color = None;
                    if sub.len() > 1 {
                        if sub[1] == "5" && sub.len() > 2 && is_digits(sub[2]) {
                            color = Some(cell::Color::Palette(int(sub[2])?.low));
                        } else if sub[1] == "2"
                            && sub.len() >= 5
                            && sub[sub.len() - 3..].iter().all(|v| is_digits(v))
                        {
                            let rgb = &sub[sub.len() - 3..];
                            color = Some(cell::Color::Rgb(
                                int(rgb[0])?.low,
                                int(rgb[1])?.low,
                                int(rgb[2])?.low,
                            ));
                        }
                    } else if i < parts.len() && parts[i] == "5" {
                        if i + 1 < parts.len() && is_digits(parts[i + 1]) {
                            color = Some(cell::Color::Palette(int(parts[i + 1])?.low));
                        }
                        i += 2;
                    } else if i < parts.len() && parts[i] == "2" {
                        let rgb = &parts[(i + 1).min(parts.len())..(i + 4).min(parts.len())];
                        if rgb.len() == 3 && rgb.iter().all(|v| is_digits(v)) {
                            color = Some(cell::Color::Rgb(
                                int(rgb[0])?.low,
                                int(rgb[1])?.low,
                                int(rgb[2])?.low,
                            ));
                        }
                        i += 4;
                    }
                    // underline color: xterm draws it, the history keeps plain underline
                    if let (Some(color), true) = (color, code != 58) {
                        if code == 38 {
                            change.fg = color;
                        } else {
                            change.bg = color;
                        }
                    }
                }
                Some(c @ 30..=37) => change.fg = cell::Color::Named((c - 30) as u8),
                Some(c @ 40..=47) => change.bg = cell::Color::Named((c - 40) as u8),
                Some(c @ 90..=97) => change.fg = cell::Color::Bright((c - 90) as u8),
                Some(c @ 100..=107) => change.bg = cell::Color::Bright((c - 100) as u8),
                Some(39) => change.fg = cell::Color::Default,
                Some(49) => change.bg = cell::Color::Default,
                Some(4) => change.set(cell::UNDERSCORE, !(sub.len() > 1 && sub[1] == "0")),
                Some(1) => change.set(cell::BOLD, true),
                Some(2) => change.set(cell::DIM, true),
                Some(3) => change.set(cell::ITALICS, true),
                Some(5 | 6) => change.set(cell::BLINK, true),
                Some(7) => change.set(cell::REVERSE, true),
                Some(8) => change.set(cell::HIDDEN, true),
                Some(9) => change.set(cell::STRIKETHROUGH, true),
                Some(21) => change.set(cell::UNDERSCORE, true),
                Some(22) => {
                    change.set(cell::BOLD, false);
                    change.set(cell::DIM, false);
                }
                Some(23) => change.set(cell::ITALICS, false),
                Some(24) => change.set(cell::UNDERSCORE, false),
                Some(25) => change.set(cell::BLINK, false),
                Some(27) => change.set(cell::REVERSE, false),
                Some(28) => change.set(cell::HIDDEN, false),
                Some(29) => change.set(cell::STRIKETHROUGH, false),
                Some(53) => change.set(cell::OVERLINE, true),
                Some(55) => change.set(cell::OVERLINE, false),
                _ => {}
            }
        }
        if changed {
            self.cursor.attrs = change;
        }
        Ok(())
    }
}

/// `str.isdigit()` on what a CSI's parameters can hold (`[0-?]`): ASCII digits, at least one.
pub(crate) fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// A decimal number as Python's `int()` reads it: exact while small, its low byte always; more than 4300 digits raise.
pub(crate) struct Int {
    /// The value, or None when it does not fit (no comparison with a small number can then hold).
    pub value: Option<i64>,
    /// `int(...) & 255`.
    pub low: u8,
}

pub(crate) fn int(s: &str) -> Result<Int, Fault> {
    if s.len() > 4300 {
        return Err(Fault); // ValueError: Exceeds the limit (4300 digits) for integer string conversion
    }
    let mut value: Option<i64> = Some(0);
    let mut low: u32 = 0;
    for b in s.bytes() {
        let d = (b - b'0') as i64;
        value = value
            .and_then(|v| v.checked_mul(10))
            .and_then(|v| v.checked_add(d));
        low = (low * 10 + d as u32) % 256;
    }
    Ok(Int {
        value,
        low: low as u8,
    })
}
