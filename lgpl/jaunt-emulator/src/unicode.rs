// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) Emeric Commenge for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! Character widths and grapheme clusters exactly as the web terminal counts them (host/jaunt/graphemes.py, itself
//! web/js/unicode.mjs over the same generated table). A property value packs `(state << 3) | (width << 1) | joins`.

use super::unicode_table::{STARTS, VALUES};

const PREPEND: i64 = 1;
const EXTEND: i64 = 2;
const RI: i64 = 3;
const SPACING: i64 = 4;
const L: i64 = 5;
const V: i64 = 6;
const T: i64 = 7;
const LV: i64 = 8;
const LVT: i64 = 9;
const ZWJ: i64 = 10;
const EXTPIC: i64 = 11;
const RI_PAIR: i64 = 32;
/// An ASCII character after anything that does not join: one cell.
pub(crate) const PLAIN: u32 = 1 << 1;

fn info(cp: u32) -> i64 {
    let i = STARTS.partition_point(|&s| s <= cp);
    VALUES[i - 1] as i64
}

fn joins(before: i64, after: i64) -> bool {
    if (L..=LVT).contains(&before) {
        if before == L && matches!(after, L | V | LV | LVT) {
            return true;
        }
        if matches!(before, LV | V) && matches!(after, V | T) {
            return true;
        }
        if matches!(before, LVT | T) && after == T {
            return true;
        }
    }
    if matches!(after, EXTEND | ZWJ | SPACING) || before == PREPEND {
        return true;
    }
    if before == ZWJ && after == EXTPIC {
        return true;
    }
    after == RI && before == RI
}

/// `graphemes.properties`: the properties of `cp` printed after a character whose properties were `preceding`.
pub(crate) fn properties(cp: u32, preceding: u32) -> u32 {
    if (32..127).contains(&cp) && preceding >> 3 == 0 {
        return PLAIN;
    }
    let preceding = preceding as i64;
    let mut state = info(cp);
    let w = (state & 0x30) >> 4;
    let mut w = if w >= 2 {
        if w == 3 || cp == 0xFE0F {
            2
        } else {
            1
        }
    } else {
        1
    };
    let mut join = 0;
    if preceding != 0 {
        let old = (preceding >> 1) & 3;
        let after = state & 0xF;
        if joins((preceding >> 3) & 0xF, after) {
            state = if after == RI { RI_PAIR } else { after + 16 };
            join = 1;
            if old > w {
                w = old;
            } else if state == RI_PAIR {
                w = 2;
            }
        } else {
            state = after - 16;
        }
    }
    (((state & 0xFF_FFFF) << 3) | ((w & 3) << 1) | join) as u32
}

/// `graphemes.width`: the cells `text` takes once printed from a fresh state.
pub fn width(text: &str) -> usize {
    let (mut total, mut state) = (0i64, 0u32);
    for ch in text.chars() {
        let props = properties(ch as u32, state);
        let w = ((props >> 1) & 3) as i64;
        total += if props & 1 != 0 {
            w - ((state >> 1) & 3) as i64
        } else {
            w
        };
        state = props;
    }
    total.max(0) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_as_the_web_terminal_gives_them() {
        // tests/test_screen.py's own cases.
        let got: Vec<usize> = ["😀", "👍🏽", "🇫🇷", "❤️", "⚠️", "👨‍👩‍👧", "한", "é", "a"]
            .iter()
            .map(|s| width(s))
            .collect();
        assert_eq!(got, [2, 2, 2, 2, 2, 2, 2, 1, 1]);
    }
}
