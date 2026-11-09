// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) Emeric Commenge for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! Cells and their attributes, and a row serialized as text with SGR (screen.py `Cell`, `_sgr`, `serialize`).

use std::fmt::Write as _;

/// A color as screen.py keeps it: pyte's `"default"`, a named ANSI color (`"red"`, `"brown"`...), its bright form
/// (`"brightred"`), a palette index (`"p208"`) or 24-bit (`"ff8700"`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Color {
    #[default]
    Default,
    Named(u8),
    Bright(u8),
    Palette(u8),
    Rgb(u8, u8, u8),
}

impl Color {
    /// SGR parameters for this color (`_color`): `base` is 30 for the foreground, 40 for the background.
    fn sgr(self, base: u32, out: &mut String) {
        match self {
            Color::Default => write!(out, "{}", base + 9),
            Color::Named(n) => write!(out, "{}", base + n as u32),
            Color::Bright(n) => write!(out, "{}", base + 60 + n as u32),
            Color::Palette(n) => write!(out, "{};5;{}", base + 8, n),
            Color::Rgb(r, g, b) => write!(out, "{};2;{};{};{}", base + 8, r, g, b),
        }
        .expect("writing to a String");
    }
}

pub(crate) const BOLD: u16 = 1;
pub(crate) const ITALICS: u16 = 1 << 1;
pub(crate) const UNDERSCORE: u16 = 1 << 2;
pub(crate) const STRIKETHROUGH: u16 = 1 << 3;
pub(crate) const REVERSE: u16 = 1 << 4;
pub(crate) const BLINK: u16 = 1 << 5;
pub(crate) const DIM: u16 = 1 << 6;
pub(crate) const HIDDEN: u16 = 1 << 7;
pub(crate) const OVERLINE: u16 = 1 << 8;

/// Everything of a cell but its text (`Cell[1:]`, what decides whether an SGR is written).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Attrs {
    pub fg: Color,
    pub bg: Color,
    pub flags: u16,
}

impl Attrs {
    pub const PLAIN: Attrs = Attrs {
        fg: Color::Default,
        bg: Color::Default,
        flags: 0,
    };

    pub fn has(&self, flag: u16) -> bool {
        self.flags & flag != 0
    }

    pub(crate) fn set(&mut self, flag: u16, on: bool) {
        if on {
            self.flags |= flag;
        } else {
            self.flags &= !flag;
        }
    }

    /// `_sgr`: the full SGR that selects these attributes from any state.
    pub fn sgr(&self) -> String {
        let mut out = String::from("\x1b[0");
        for (flag, code) in [
            (BOLD, "1"),
            (DIM, "2"),
            (ITALICS, "3"),
            (UNDERSCORE, "4"),
            (BLINK, "5"),
            (REVERSE, "7"),
            (HIDDEN, "8"),
            (STRIKETHROUGH, "9"),
            (OVERLINE, "53"),
        ] {
            if self.has(flag) {
                out.push(';');
                out.push_str(code);
            }
        }
        if self.fg != Color::Default {
            out.push(';');
            self.fg.sgr(30, &mut out);
        }
        if self.bg != Color::Default {
            out.push(';');
            self.bg.sgr(40, &mut out);
        }
        out.push('m');
        out
    }
}

/// The text of a cell: one character mostly, a grapheme cluster, or nothing (the second cell of a wide character).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Text {
    Stub,
    One(char),
    Many(Box<str>),
}

impl Text {
    pub fn is_stub(&self) -> bool {
        matches!(self, Text::Stub)
    }

    pub fn push_to(&self, out: &mut String) {
        match self {
            Text::Stub => {}
            Text::One(c) => out.push(*c),
            Text::Many(s) => out.push_str(s),
        }
    }

    pub fn to_string_lossless(&self) -> String {
        let mut s = String::new();
        self.push_to(&mut s);
        s
    }

    /// This text with `ch` appended (a character joining the cluster).
    pub(crate) fn joined(&self, ch: char) -> Text {
        match self {
            Text::Stub => Text::One(ch),
            Text::One(c) => {
                let mut s = String::with_capacity(8);
                s.push(*c);
                s.push(ch);
                Text::Many(s.into_boxed_str())
            }
            Text::Many(s) => {
                let mut s = String::from(&**s);
                s.push(ch);
                Text::Many(s.into_boxed_str())
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub text: Text,
    pub attrs: Attrs,
}

pub(crate) static BLANK: Cell = Cell {
    text: Text::One(' '),
    attrs: Attrs::PLAIN,
};

impl Cell {
    /// A space with these attributes: what erasing writes (pyte writes the cursor's attributes, whose text is a space).
    pub(crate) fn blank(attrs: Attrs) -> Cell {
        Cell {
            text: Text::One(' '),
            attrs,
        }
    }

    /// `_blank`: what a row's trailing cells may be and still be dropped.
    pub(crate) fn is_blank(&self) -> bool {
        self.text == Text::One(' ') && self.attrs.bg == Color::Default && !self.attrs.has(REVERSE)
    }
}

/// A row of the screen: pyte's sparse `StaticDefaultDict` (absent cells read as blank, and which cells are present matters:
/// erasing the display rewrites only those), with screen.py's `wrapped` flag. Keys go from -1 (a cluster joined left of
/// column 0) to the widest the screen has been.
#[derive(Clone, Debug, Default)]
pub struct Row {
    cells: Vec<Option<Cell>>,
    neg: Option<Cell>,
    pub wrapped: bool,
}

impl Row {
    pub fn get(&self, x: i64) -> &Cell {
        if x < 0 {
            return if x == -1 {
                self.neg.as_ref().unwrap_or(&BLANK)
            } else {
                &BLANK
            };
        }
        match self.cells.get(x as usize) {
            Some(Some(c)) => c,
            _ => &BLANK,
        }
    }

    pub(crate) fn set(&mut self, x: i64, cell: Cell) {
        if x < 0 {
            // Only -1 is reachable (a cluster joined to a second half moved to column 0); anything left of it is never read.
            if x == -1 {
                self.neg = Some(cell);
            }
            return;
        }
        let x = x as usize;
        if x >= self.cells.len() {
            self.cells.resize(x + 1, None);
        }
        self.cells[x] = Some(cell);
    }

    pub(crate) fn pop(&mut self, x: i64) -> Option<Cell> {
        if x < 0 {
            return if x == -1 { self.neg.take() } else { None };
        }
        let cell = self.cells.get_mut(x as usize).and_then(Option::take);
        if cell.is_some() {
            while matches!(self.cells.last(), Some(None)) {
                self.cells.pop();
            }
        }
        cell
    }

    /// `max(line, default=-1)`.
    fn max_key(&self) -> i64 {
        if !self.cells.is_empty() {
            return self.cells.len() as i64 - 1;
        }
        -1
    }

    /// Every present cell, rewritten by `f` (pyte's `for x in line: line[x] = ...`).
    pub(crate) fn rewrite_present(&mut self, mut f: impl FnMut(&Cell) -> Cell) {
        if let Some(c) = &self.neg {
            self.neg = Some(f(c));
        }
        for c in self.cells.iter_mut().flatten() {
            *c = f(c);
        }
    }

    /// The present keys at or beyond `from` are dropped (pyte's resize to fewer columns).
    pub(crate) fn truncate(&mut self, from: i64, to: i64) {
        for x in from.max(0)..to {
            self.pop(x);
        }
    }

    /// `serialize`: one screen row as text with SGR, trailing blanks dropped.
    pub fn serialize(&self, columns: i64, trim: bool) -> String {
        let mut end = if trim {
            columns.min(self.max_key() + 1)
        } else {
            columns
        };
        while end > 0 && self.get(end - 1).is_blank() {
            end -= 1;
        }
        let mut out = String::new();
        let mut style = Attrs::PLAIN;
        for x in 0..end.max(0) {
            let c = self.get(x);
            if c.text.is_stub() {
                continue;
            }
            if c.attrs != style {
                out.push_str(&c.attrs.sgr());
                style = c.attrs;
            }
            c.text.push_to(&mut out);
        }
        if style != Attrs::PLAIN {
            out.push_str("\x1b[0m");
        }
        out
    }
}
