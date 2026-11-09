// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) Emeric Commenge for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! Output bytes to screen operations, as screen.py's `Parser` does (itself as xterm.js parses them): UTF-8 decoded
//! incrementally with replacement characters, then cut into text, CSI, strings (OSC, DCS, APC, PM, SOS: swallowed), ESC
//! sequences and controls, with the same alternatives in the same order as its regular expression `TOKEN`.

use super::screen::{int, is_digits, Fault, Screen};

const ESC: char = '\x1b';

/// Python's incremental UTF-8 decoder with `errors="replace"`: maximal invalid subparts become U+FFFD, an incomplete
/// sequence at the end waits for the next bytes, and so does a truncated surrogate (`ED A0..BF`), as CPython keeps it.
#[derive(Default)]
struct Decoder {
    carry: Vec<u8>,
}

impl Decoder {
    fn decode(&mut self, data: &[u8], out: &mut String) {
        let joined;
        let mut rest: &[u8] = if self.carry.is_empty() {
            data
        } else {
            let mut v = std::mem::take(&mut self.carry);
            v.extend_from_slice(data);
            joined = v;
            &joined
        };
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    out.push_str(s);
                    return;
                }
                Err(e) => {
                    let (valid, after) = rest.split_at(e.valid_up_to());
                    out.push_str(std::str::from_utf8(valid).expect("valid prefix"));
                    match e.error_len() {
                        None => {
                            self.carry = after.to_vec();
                            return;
                        }
                        Some(_)
                            if after.len() == 2
                                && after[0] == 0xED
                                && (0xA0..=0xBF).contains(&after[1]) =>
                        {
                            self.carry = after.to_vec();
                            return;
                        }
                        Some(n) => {
                            out.push('\u{FFFD}');
                            rest = &after[n..];
                        }
                    }
                }
            }
        }
    }
}

enum Token<'a> {
    Text(&'a str),
    Csi(&'a str, &'a str, char),
    String,
    Esc(&'a str, char),
    Control(char),
}

fn is_text(c: char) -> bool {
    !(c <= '\x1f' || ('\x7f'..='\u{9f}').contains(&c))
}

fn in_range(c: char, lo: char, hi: char) -> bool {
    (lo..=hi).contains(&c)
}

/// The end (byte index) of the run of characters from `pos` that `keep` accepts.
fn run(text: &str, pos: usize, keep: impl Fn(char) -> bool) -> usize {
    text[pos..]
        .char_indices()
        .find(|&(_, c)| !keep(c))
        .map_or(text.len(), |(i, _)| pos + i)
}

fn char_at(text: &str, pos: usize) -> Option<char> {
    text[pos..].chars().next()
}

/// `TOKEN.match(text, pos)`.
fn token(text: &str, pos: usize) -> Option<(Token<'_>, usize)> {
    let c = char_at(text, pos)?;
    // 1 text
    if is_text(c) {
        let end = run(text, pos, is_text);
        return Some((Token::Text(&text[pos..end]), end));
    }
    let next = char_at(text, pos + c.len_utf8());
    // 2-4 CSI
    let csi_body = match (c, next) {
        (ESC, Some('[')) => Some(pos + 2),
        ('\u{9b}', _) => Some(pos + 2),
        _ => None,
    };
    if let Some(start) = csi_body {
        let params_end = run(text, start, |c| in_range(c, '0', '?'));
        let inter_end = run(text, params_end, |c| in_range(c, ' ', '/'));
        if let Some(f) = char_at(text, inter_end).filter(|&f| in_range(f, '@', '~')) {
            return Some((
                Token::Csi(&text[start..params_end], &text[params_end..inter_end], f),
                inter_end + 1,
            ));
        }
    }
    // 5 string
    let string_body = match (c, next) {
        (ESC, Some(']' | 'P' | '_' | '^' | 'X')) => Some(pos + 2),
        ('\u{9d}' | '\u{90}' | '\u{9f}' | '\u{9e}' | '\u{98}', _) => Some(pos + 2),
        _ => None,
    };
    if let Some(start) = string_body {
        let body_end = run(text, start, |c| !matches!(c, '\x07' | ESC | '\u{9c}'));
        match char_at(text, body_end) {
            Some('\x07') => return Some((Token::String, body_end + 1)),
            Some('\u{9c}') => return Some((Token::String, body_end + 2)),
            Some(ESC) if char_at(text, body_end + 1) == Some('\\') => {
                return Some((Token::String, body_end + 2))
            }
            _ => {}
        }
    }
    // 6-7 ESC
    if c == ESC {
        let inter_end = run(text, pos + 1, |c| in_range(c, ' ', '/'));
        if let Some(f) = char_at(text, inter_end) {
            let ok = in_range(f, '0', 'O')
                || in_range(f, 'Q', 'W')
                || matches!(f, 'Y' | 'Z' | '\\')
                || in_range(f, '`', '~');
            if ok {
                return Some((Token::Esc(&text[pos + 1..inter_end], f), inter_end + 1));
            }
        }
    }
    // 8 control
    if c <= '\x1a' || in_range(c, '\x1c', '\x1f') || in_range(c, '\x7f', '\u{9f}') {
        return Some((Token::Control(c), pos + c.len_utf8()));
    }
    None
}

/// `STRING_START.match(rest)`.
fn string_start(rest: &str) -> bool {
    let mut it = rest.chars();
    match it.next() {
        Some(ESC) => matches!(it.next(), Some(']' | 'P' | '_' | '^' | 'X')),
        Some('\u{9d}' | '\u{90}' | '\u{9f}' | '\u{9e}' | '\u{98}') => true,
        _ => false,
    }
}

/// `STRING_END.search(text)`: the end of the first terminator.
fn string_end(text: &str) -> Option<usize> {
    let mut it = text.char_indices().peekable();
    while let Some((i, c)) = it.next() {
        match c {
            '\x07' => return Some(i + 1),
            '\u{9c}' => return Some(i + 2),
            ESC if matches!(it.peek(), Some((_, '\\'))) => return Some(i + 2),
            _ => {}
        }
    }
    None
}

/// `PARTIAL.match(rest)`: a sequence that the next output may complete.
fn partial(rest: &str) -> bool {
    let Some(s) = rest.strip_prefix(ESC) else {
        return false;
    };
    let all = |s: &str, f: fn(char) -> bool| s.chars().all(f);
    if s.is_empty() || all(s, |c| in_range(c, ' ', '/')) {
        return true;
    }
    if let Some(body) = s.strip_prefix('[') {
        let params_end = run(body, 0, |c| in_range(c, '0', '?'));
        return all(&body[params_end..], |c| in_range(c, ' ', '/'));
    }
    false
}

#[derive(Default)]
pub(crate) struct Parser {
    decoder: Decoder,
    carry: String,
    /// Inside a string sequence (OSC, DCS...) that continues in later output.
    swallow: bool,
}

impl Parser {
    pub(crate) fn feed(&mut self, s: &mut Screen, data: &[u8]) -> Result<(), Fault> {
        let mut text = std::mem::take(&mut self.carry);
        self.decoder.decode(data, &mut text);
        let mut pos = 0;
        let n = text.len();
        if self.swallow {
            match string_end(&text) {
                None => {
                    if text.ends_with(ESC) {
                        self.carry.push(ESC);
                    }
                    return Ok(());
                }
                Some(end) => {
                    pos = end;
                    self.swallow = false;
                }
            }
        }
        while pos < n {
            let Some((tok, end)) = token(&text, pos) else {
                let rest = &text[pos..];
                if string_start(rest) {
                    self.swallow = true; // its end arrives later
                    if rest.ends_with(ESC) {
                        self.carry.push(ESC);
                    }
                    return Ok(());
                }
                if partial(rest) && rest.chars().count() < 256 {
                    self.carry = rest.to_string();
                    return Ok(());
                }
                pos += 1; // a malformed sequence: drop its introducer (an ESC), as xterm ignores it
                s.join = 0;
                continue;
            };
            pos = end;
            match tok {
                Token::Text(run) => {
                    s.draw(run);
                    continue;
                }
                Token::Csi(params, inter, f) => csi(s, params, inter, f)?,
                Token::Esc(inter, f) => esc(s, inter, f)?,
                Token::Control(c) => control(s, c),
                Token::String => {}
            }
            s.join = 0;
        }
        Ok(())
    }
}

fn control(s: &mut Screen, ch: char) {
    match ch {
        '\n' | '\x0b' | '\x0c' => s.linefeed(),
        '\r' => s.carriage_return(),
        '\x08' => s.backspace(),
        '\t' => s.tab(),
        '\x0e' => s.shift_out(),
        '\x0f' => s.shift_in(),
        '\u{84}' => s.index(),
        '\u{85}' => {
            s.carriage_return();
            s.linefeed();
        }
        '\u{8d}' => s.reverse_index(),
        _ => {}
    }
}

fn esc(s: &mut Screen, inter: &str, f: char) -> Result<(), Fault> {
    if inter == "(" || inter == ")" {
        s.define_charset(f, inter.chars().next().unwrap_or('('));
    } else if inter == "#" {
        if f == '8' {
            s.alignment_display();
        }
    } else if !inter.is_empty() {
        return Ok(());
    } else {
        match f {
            '7' => s.save_cursor(),
            '8' => s.restore_cursor()?,
            'D' => s.index(),
            'E' => {
                s.carriage_return();
                s.linefeed();
            }
            'M' => s.reverse_index(),
            'H' => s.set_tab_stop(),
            'c' => s.reset(),
            _ => {}
        }
    }
    Ok(())
}

/// The operations a CSI final calls with its parameters (screen.py `CSI`), and how many they take: more raise in Python.
fn arity(f: char) -> Option<usize> {
    match f {
        '@' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'L' | 'M' | 'P' | 'X' | '`' | 'a' | 'd'
        | 'e' | 'g' => Some(1),
        'H' | 'f' | 'r' => Some(2),
        'J' | 'K' => Some(1),
        _ => None,
    }
}

fn csi(s: &mut Screen, params: &str, inter: &str, f: char) -> Result<(), Fault> {
    let private = params
        .chars()
        .next()
        .filter(|c| matches!(c, '<' | '=' | '>' | '?'));
    let params = if private.is_some() {
        &params[1..]
    } else {
        params
    };
    if !inter.is_empty() {
        if inter == "!" && f == 'p' && private.is_none() {
            s.soft_reset();
        }
        return Ok(()); // cursor style, mode reports and other intermediate forms change no cell
    }
    if private.is_some() && private != Some('?') {
        return Ok(()); // key encodings, secondary attributes...: requests, not output
    }
    if f == 'm' {
        if private.is_none() {
            s.sgr(params)?;
        }
        return Ok(());
    }
    let mut values: Vec<i64> = Vec::new();
    if !params.is_empty() {
        for p in params.split(';') {
            let head = p.split(':').next().unwrap_or("");
            values.push(if is_digits(head) {
                int(head)?.value.map_or(9999, |v| v.min(9999))
            } else {
                0
            });
        }
    }
    if f == 'h' || f == 'l' {
        return if f == 'h' {
            s.set_mode(&values, private.is_some())
        } else {
            s.reset_mode(&values, private.is_some())
        };
    }
    if private.is_some() {
        // selective erase: nothing is protected here
        return match f {
            'J' => s.erase_in_display(values.first().copied().unwrap_or(0)),
            'K' => s.erase_in_line(values.first().copied().unwrap_or(0)),
            _ => Ok(()),
        };
    }
    if "@ABCDEFIPSTXZaeLMb".contains(f) && s.cursor.x >= s.columns {
        s.cursor.x = s.columns - 1; // xterm first brings a pending-wrap cursor back onto the line
    }
    let count = values.first().copied().unwrap_or(0);
    match f {
        'S' => s.scroll(count, true),
        'T' => {
            if values.len() <= 1 {
                s.scroll(count, false);
            }
        }
        'b' => s.repeat(count),
        'I' => s.tabs(count, true),
        'Z' => s.tabs(count, false),
        's' => s.save_cursor(),
        'u' => s.restore_cursor()?,
        _ => {
            let Some(max) = arity(f) else {
                return Ok(());
            };
            if f == 'J' || f == 'K' {
                values.truncate(1);
            }
            if values.len() > max {
                return Err(Fault); // TypeError: too many positional arguments
            }
            let a = values.first().copied();
            let b = values.get(1).copied();
            match f {
                '@' => s.insert_characters(a),
                'A' => s.cursor_up(a),
                'B' | 'e' => s.cursor_down(a),
                'C' | 'a' => s.cursor_forward(a),
                'D' => s.cursor_back(a),
                'E' => s.cursor_down1(a),
                'F' => s.cursor_up1(a),
                'G' | '`' => s.cursor_to_column(a),
                'H' | 'f' => s.cursor_position(a, b),
                'J' => s.erase_in_display(a.unwrap_or(0))?,
                'K' => s.erase_in_line(a.unwrap_or(0))?,
                'L' => s.insert_lines(a),
                'M' => s.delete_lines(a),
                'P' => s.delete_characters(a),
                'X' => s.erase_characters(a),
                'd' => s.cursor_to_line(a)?,
                'g' => s.clear_tab_stop(a),
                'r' => s.set_margins(a, b),
                _ => {}
            }
        }
    }
    Ok(())
}
