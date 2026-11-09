// jaunt-emulator: a port of pyte 0.8.2 (https://github.com/selectel/pyte) and of jaunt's host/jaunt/screen.py over it.
// Copyright (c) 2011-2012 by Selectel, (c) 2012-2017 by pyte authors and contributors (AUTHORS.pyte), (c) Emeric Commenge for the port.
// Free software under the GNU Lesser General Public License, version 3 or (at your option) any later version (LICENSE, COPYING.GPL).

//! The C interface of the shared library: what the host loads at run time (`libjaunt_emulator.so`, `.dylib`, `jaunt_emulator.dll`).
//!
//! A log is an opaque pointer made by [`jaunt_emu_new`] and freed by [`jaunt_emu_free`]; one thread uses it at a time. Texts go in
//! and out as UTF-8 JSON (the export, the view, the history lines) or bytes (output, snapshots). A buffer the library hands out
//! ([`Buf`]) is given back to [`jaunt_emu_buf_free`]. Every function returns 0 for success (or a count, or 1 for "more") and a
//! negative number for a failure: [`ERR_ARGUMENT`] a null pointer, a text that is not UTF-8 or JSON that is not a state,
//! [`ERR_PANIC`] a bug caught at the boundary (nothing unwinds into the caller). The ABI is [`ABI_VERSION`]: a host that finds
//! another number in a library must not call anything else of it.
//!
//! Changing a signature or what a function means raises [`ABI_VERSION`]; adding a function does too (a host checks for equality).

#![allow(unsafe_code, clippy::missing_safety_doc)]

use std::ffi::c_char;
use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::{ScreenLog, State};

/// The version of this interface. The host checks it for equality, before anything else.
pub const ABI_VERSION: u32 = 1;
pub const ERR_ARGUMENT: i32 = -2;
pub const ERR_PANIC: i32 = -1;

/// What [`jaunt_emu_info`] says: the crate's version, the pyte it ports and the interface version, for the host's status.
const INFO: &str = concat!(
    "jaunt-emulator ",
    env!("CARGO_PKG_VERSION"),
    " (port of pyte 0.8.2, ABI 1)\0"
);

/// A buffer owned by the library: bytes (or UTF-8 text) to be read, then given back to [`jaunt_emu_buf_free`].
#[repr(C)]
pub struct Buf {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

/// One retained read for [`jaunt_emu_restore`] (the host's replay ring): where it began, its bytes, the size of the terminal then.
#[repr(C)]
pub struct RingEntry {
    pub offset: u64,
    pub data: *const u8,
    pub len: usize,
    pub cols: i64,
    pub rows: i64,
}

fn guard<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or(fallback)
}

fn hand_out(out: *mut Buf, bytes: Vec<u8>) -> i32 {
    if out.is_null() {
        return ERR_ARGUMENT;
    }
    let mut bytes = std::mem::ManuallyDrop::new(bytes);
    // SAFETY: `out` is non-null and the caller gave a place for a Buf.
    unsafe {
        *out = Buf {
            ptr: bytes.as_mut_ptr(),
            len: bytes.len(),
            cap: bytes.capacity(),
        };
    }
    0
}

/// `len` bytes at `ptr`, or an empty slice for a null pointer with no length.
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        Some(&[])
    } else if ptr.is_null() {
        None
    } else {
        Some(std::slice::from_raw_parts(ptr, len))
    }
}

unsafe fn text<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    std::str::from_utf8(bytes(ptr, len)?).ok()
}

#[no_mangle]
pub extern "C" fn jaunt_emu_abi() -> u32 {
    ABI_VERSION
}

/// A static NUL-terminated text naming this library, never freed.
#[no_mangle]
pub extern "C" fn jaunt_emu_info() -> *const c_char {
    INFO.as_ptr() as *const c_char
}

/// A new log, or null (a bug caught).
#[no_mangle]
pub extern "C" fn jaunt_emu_new(cols: i64, rows: i64, limit: u64) -> *mut ScreenLog {
    guard(std::ptr::null_mut(), || {
        Box::into_raw(Box::new(ScreenLog::new(cols, rows, limit as usize)))
    })
}

#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_free(log: *mut ScreenLog) {
    if !log.is_null() {
        let _ = catch_unwind(AssertUnwindSafe(|| drop(Box::from_raw(log))));
    }
}

#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_buf_free(buf: Buf) {
    if !buf.ptr.is_null() {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            drop(Vec::from_raw_parts(buf.ptr, buf.len, buf.cap))
        }));
    }
}

/// Queue output that began at stream `offset`; `alt`: whether the stream was in the alternate screen there.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_feed(
    log: *mut ScreenLog,
    offset: u64,
    data: *const u8,
    len: usize,
    alt: u8,
) -> i32 {
    let (Some(log), Some(data)) = (log.as_mut(), bytes(data, len)) else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        log.feed(offset, data, alt != 0);
        0
    })
}

#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_resize(log: *mut ScreenLog, cols: i64, rows: i64) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        log.resize(cols, rows);
        0
    })
}

#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_set_limit(log: *mut ScreenLog, lines: u64) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        log.set_limit(lines as usize);
        0
    })
}

#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_limit(log: *const ScreenLog) -> u64 {
    log.as_ref().map_or(0, |l| guard(0, || l.limit() as u64))
}

/// After an in-place update: `history` is a JSON array of the lines carried over (or empty for none), `ring` the retained reads.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_restore(
    log: *mut ScreenLog,
    history: *const u8,
    history_len: usize,
    ring: *const RingEntry,
    ring_len: usize,
) -> i32 {
    let (Some(log), Some(history)) = (log.as_mut(), text(history, history_len)) else {
        return ERR_ARGUMENT;
    };
    if ring.is_null() && ring_len > 0 {
        return ERR_ARGUMENT;
    }
    let lines: Vec<String> = if history.is_empty() {
        Vec::new()
    } else {
        match serde_json::from_str(history) {
            Ok(v) => v,
            Err(_) => return ERR_ARGUMENT,
        }
    };
    let mut entries = Vec::with_capacity(ring_len);
    for i in 0..ring_len {
        let e = &*ring.add(i);
        let Some(data) = bytes(e.data, e.len) else {
            return ERR_ARGUMENT;
        };
        entries.push((e.offset, data.to_vec(), e.cols, e.rows));
    }
    guard(ERR_PANIC, || {
        log.restore(lines, &entries);
        0
    })
}

/// Consume some waiting output (at most about `budget` bytes): 1 while more waits, 0 when nothing does.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_work(log: *mut ScreenLog, budget: usize) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || i32::from(log.work(budget)))
}

/// Consume everything waiting.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_drain(log: *mut ScreenLog) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        log.drain();
        0
    })
}

/// 1 when output waits, else 0.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_pending(log: *const ScreenLog) -> i32 {
    log.as_ref().map_or(ERR_ARGUMENT, |l| {
        guard(ERR_PANIC, || i32::from(l.has_pending()))
    })
}

/// The stream offset the emulator has consumed up to.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_offset(log: *const ScreenLog) -> u64 {
    log.as_ref().map_or(0, |l| guard(0, || l.offset))
}

/// Set the stream offset (a log taken over at a known place of the stream).
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_set_offset(log: *mut ScreenLog, offset: u64) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        log.offset = offset;
        0
    })
}

/// What the worker did to the screen so far: a reader may keep what it worked out while this stays.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_changes(log: *const ScreenLog) -> u64 {
    log.as_ref().map_or(0, |l| guard(0, || l.changes))
}

/// The size the emulated screen has now.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_size(
    log: *const ScreenLog,
    cols: *mut i64,
    rows: *mut i64,
) -> i32 {
    let (Some(log), false, false) = (log.as_ref(), cols.is_null(), rows.is_null()) else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        let (c, r) = log.size();
        *cols = c;
        *rows = r;
        0
    })
}

/// The export (screen.py `export`) as the compact JSON of persist.py's `save_screen`; `history`: 0 leaves the lines out.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_export(log: *mut ScreenLog, history: u8, out: *mut Buf) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    match catch_unwind(AssertUnwindSafe(|| log.export(history != 0).to_json())) {
        Ok(json) => hand_out(out, json.into_bytes()),
        Err(_) => ERR_PANIC,
    }
}

/// The counterpart of the export: this log takes that state's history and screens (its size included).
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_load(log: *mut ScreenLog, json: *const u8, len: usize) -> i32 {
    let (Some(log), Some(json)) = (log.as_mut(), text(json, len)) else {
        return ERR_ARGUMENT;
    };
    let Ok(state) = State::from_json(json) else {
        return ERR_ARGUMENT;
    };
    guard(ERR_PANIC, || {
        log.load(&state);
        0
    })
}

/// The last `lines` history lines then the screen (and `modes`, the termstate prefix, before the cursor): the bytes to send, the
/// stream offset they stand at and the size of the screen.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_snapshot(
    log: *mut ScreenLog,
    lines: u64,
    modes: *const u8,
    modes_len: usize,
    out: *mut Buf,
    offset: *mut u64,
    cols: *mut i64,
    rows: *mut i64,
) -> i32 {
    let (Some(log), Some(modes)) = (log.as_mut(), bytes(modes, modes_len)) else {
        return ERR_ARGUMENT;
    };
    if offset.is_null() || cols.is_null() || rows.is_null() {
        return ERR_ARGUMENT;
    }
    match catch_unwind(AssertUnwindSafe(|| log.snapshot(lines as usize, modes))) {
        Ok((at, data, (c, r))) => {
            *offset = at;
            *cols = c;
            *rows = r;
            hand_out(out, data)
        }
        Err(_) => ERR_PANIC,
    }
}

/// The screen as it shows now, for the rich view: JSON, `ScreenRows::to_json`.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_view(log: *mut ScreenLog, out: *mut Buf) -> i32 {
    let Some(log) = log.as_mut() else {
        return ERR_ARGUMENT;
    };
    match catch_unwind(AssertUnwindSafe(|| log.rows_text_dim().to_json())) {
        Ok(json) => hand_out(out, json.into_bytes()),
        Err(_) => ERR_PANIC,
    }
}

/// The history lines, as a JSON array of strings.
#[no_mangle]
pub unsafe extern "C" fn jaunt_emu_lines(log: *const ScreenLog, out: *mut Buf) -> i32 {
    let Some(log) = log.as_ref() else {
        return ERR_ARGUMENT;
    };
    match catch_unwind(AssertUnwindSafe(|| log.lines_json())) {
        Ok(json) => hand_out(out, json.into_bytes()),
        Err(_) => ERR_PANIC,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_interface_round_trips_a_log() {
        unsafe {
            let log = jaunt_emu_new(20, 4, 50);
            assert!(!log.is_null());
            let data = b"hello\r\n\x1b[1mworld\x1b[0m";
            assert_eq!(jaunt_emu_feed(log, 0, data.as_ptr(), data.len(), 0), 0);
            assert_eq!(jaunt_emu_pending(log), 1);
            assert_eq!(jaunt_emu_drain(log), 0);
            assert_eq!(jaunt_emu_offset(log), data.len() as u64);
            let mut buf = Buf {
                ptr: std::ptr::null_mut(),
                len: 0,
                cap: 0,
            };
            assert_eq!(jaunt_emu_export(log, 1, &mut buf), 0);
            let json = std::slice::from_raw_parts(buf.ptr, buf.len).to_vec();
            jaunt_emu_buf_free(buf);
            let copy = jaunt_emu_new(1, 1, 50);
            assert_eq!(jaunt_emu_load(copy, json.as_ptr(), json.len()), 0);
            let (mut a, mut b) = (
                Buf {
                    ptr: std::ptr::null_mut(),
                    len: 0,
                    cap: 0,
                },
                Buf {
                    ptr: std::ptr::null_mut(),
                    len: 0,
                    cap: 0,
                },
            );
            assert_eq!(jaunt_emu_view(log, &mut a), 0);
            assert_eq!(jaunt_emu_view(copy, &mut b), 0);
            assert_eq!(
                std::slice::from_raw_parts(a.ptr, a.len),
                std::slice::from_raw_parts(b.ptr, b.len)
            );
            jaunt_emu_buf_free(a);
            jaunt_emu_buf_free(b);
            assert_eq!(jaunt_emu_load(copy, b"not json".as_ptr(), 8), ERR_ARGUMENT);
            assert_eq!(
                jaunt_emu_feed(std::ptr::null_mut(), 0, data.as_ptr(), 1, 0),
                ERR_ARGUMENT
            );
            jaunt_emu_free(log);
            jaunt_emu_free(copy);
        }
        assert_eq!(jaunt_emu_abi(), 1);
        let info = unsafe { std::ffi::CStr::from_ptr(jaunt_emu_info()) }
            .to_str()
            .unwrap();
        assert!(
            info.starts_with("jaunt-emulator ") && info.ends_with("ABI 1)"),
            "{info}"
        );
    }
}
