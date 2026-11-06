// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) moukrea for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! What a log exports to rebuild itself after the host restarts (`ScreenLog.export`/`load`): the JSON the Python host keeps in
//! `<state>/scrollback/<id>/screen.json.z` once compressed (persist.py `save_screen`/`load_screen`; the file itself is the
//! host's, not this library's).
//!
//! The JSON is written as Python's `json.dumps(state, separators=(",", ":"))` writes it (same key order, ASCII only with
//! `\uXXXX` escapes), so what either runtime exports is the same bytes.

use std::fmt::Write as _;

use serde_json::Value;

/// One screen of a state: rows as text with SGR, their wrapped flags, the cursor and whether it is hidden.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ScreenState {
    pub screen: Vec<String>,
    pub wrapped: Vec<bool>,
    pub cursor: (i64, i64),
    pub hidden: bool,
}

/// `ScreenLog.export()`: the history, the normal screen, and the alternate one a full-screen program shows (`alt`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    pub offset: u64,
    pub cols: i64,
    pub rows: i64,
    pub history: Vec<String>,
    pub pending: String,
    pub main: ScreenState,
    pub alt: Option<ScreenState>,
}

/// A JSON string as Python's `json.dumps` writes it with `ensure_ascii` (its default).
pub fn json_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            ' '..='~' => out.push(c),
            _ => {
                let mut units = [0u16; 2];
                for u in c.encode_utf16(&mut units) {
                    write!(out, "\\u{:04x}", u).expect("writing to a String");
                }
            }
        }
    }
    out.push('"');
}

fn json_strs(items: &[String], out: &mut String) {
    out.push('[');
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        json_str(s, out);
    }
    out.push(']');
}

impl ScreenState {
    fn write_fields(&self, out: &mut String) {
        out.push_str("\"screen\":");
        json_strs(&self.screen, out);
        out.push_str(",\"wrapped\":[");
        for (i, w) in self.wrapped.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(if *w { "true" } else { "false" });
        }
        write!(
            out,
            "],\"cursor\":[{},{}],\"hidden\":{}",
            self.cursor.0, self.cursor.1, self.hidden
        )
        .expect("writing to a String");
    }

    pub fn to_json(&self) -> String {
        let mut out = String::from("{");
        self.write_fields(&mut out);
        out.push('}');
        out
    }

    fn from_value(v: &Value, rows: i64, cols: i64) -> ScreenState {
        let screen = match v.get("screen") {
            Some(Value::Array(a)) => a
                .iter()
                .take(rows.max(0) as usize)
                .map(|t| t.as_str().unwrap_or("").to_string())
                .collect(),
            _ => Vec::new(),
        };
        let wrapped = match v.get("wrapped") {
            Some(Value::Array(a)) => a
                .iter()
                .map(|w| w == &Value::Bool(true) || w.as_f64() == Some(1.0))
                .collect(),
            _ => Vec::new(),
        };
        let cursor = match v.get("cursor") {
            Some(Value::Array(a)) if a.len() == 2 => {
                (number(&a[0]).unwrap_or(0), number(&a[1]).unwrap_or(0))
            }
            _ => (0, 0),
        };
        let _ = cols;
        ScreenState {
            screen,
            wrapped,
            cursor,
            hidden: truthy(v.get("hidden")),
        }
    }
}

fn number(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_u64().map(|n| n.min(i64::MAX as u64) as i64))
        .or_else(|| v.as_f64().map(|f| f as i64))
}

/// Python's `bool(value)` for what JSON holds.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

#[derive(Debug)]
pub enum LoadError {
    Io(std::io::Error),
    Format(String),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Io(e) => write!(f, "{e}"),
            LoadError::Format(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LoadError {}

impl State {
    /// The JSON Python writes for this state, byte for byte.
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(4096);
        write!(
            out,
            "{{\"offset\":{},\"cols\":{},\"rows\":{},\"history\":",
            self.offset, self.cols, self.rows
        )
        .expect("writing to a String");
        json_strs(&self.history, &mut out);
        out.push_str(",\"pending\":");
        json_str(&self.pending, &mut out);
        out.push(',');
        self.main.write_fields(&mut out);
        if let Some(alt) = &self.alt {
            out.push_str(",\"alt\":");
            out.push_str(&alt.to_json());
        }
        out.push('}');
        out
    }

    /// A state as `ScreenLog.load` reads it: `cols` and `rows` are required, everything else has the same defaults.
    pub fn from_json(text: &str) -> Result<State, LoadError> {
        let v: Value = serde_json::from_str(text).map_err(|e| LoadError::Format(e.to_string()))?;
        State::from_value(&v)
    }

    pub fn from_value(v: &Value) -> Result<State, LoadError> {
        if !v.is_object() {
            return Err(LoadError::Format("a state is an object".into()));
        }
        let cols = v
            .get("cols")
            .and_then(number)
            .ok_or_else(|| LoadError::Format("cols".into()))?;
        let rows = v
            .get("rows")
            .and_then(number)
            .ok_or_else(|| LoadError::Format("rows".into()))?;
        if cols < 1 || rows < 1 {
            return Err(LoadError::Format("an empty screen".into()));
        }
        let history = match v.get("history") {
            Some(Value::Array(a)) => a
                .iter()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect(),
            _ => Vec::new(),
        };
        let pending = match v.get("pending") {
            Some(Value::String(s)) => s.clone(),
            _ => String::new(),
        };
        let offset = v.get("offset").and_then(number).unwrap_or(0).max(0) as u64;
        let alt = match v.get("alt") {
            Some(a @ Value::Object(_)) => Some(ScreenState::from_value(a, rows, cols)),
            _ => None,
        };
        Ok(State {
            offset,
            cols,
            rows,
            history,
            pending,
            main: ScreenState::from_value(v, rows, cols),
            alt,
        })
    }
}
