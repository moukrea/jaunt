# jaunt-emulator

The terminal emulator of jaunt's Rust host, as a shared library. It is a port of [pyte](https://github.com/selectel/pyte) 0.8.2 and of
the layer jaunt's Python host puts over it, so it is free software under the **GNU Lesser General Public License, version 3 or (at your
option) any later version** (`LICENSE` is the LGPL-3.0, `COPYING.GPL` the GPL-3.0 it refers to; `AUTHORS.pyte` names pyte's authors).
Every source file says what it is a port of.

jaunt's host is not linked with it: the host loads `libjaunt_emulator.so` (`libjaunt_emulator.dylib` on macOS, `jaunt_emulator.dll` on
Windows) when it starts, from the folder it runs from or that folder's `../lib`. You may replace the library with a build of this source
and the host will use yours.

## What it does

It keeps, for each shell, the screen a program has drawn and the history that scrolled off its top, and gives them back: as the
text-with-colors a fresh view is caught up with, as the rows the rich view reads, and as the JSON jaunt keeps on disk to bring a shell's
screen back after a restart. What it gives is meant to equal what the Python host's emulator gives for the same output, quirks included
(jaunt's tests run the same recorded terminal output through both and compare).

The interface is C (`src/ffi.rs`, every function `jaunt_emu_*`): a log is made, fed output with its stream offsets, resized, exported,
loaded, snapshotted and freed. Texts go in and out as UTF-8 JSON or bytes, and a buffer the library gives out is given back to
`jaunt_emu_buf_free`. `jaunt_emu_abi()` returns the interface version, `1` here: **the host loads a library only if that number is the
one it was built for**, and says so (in `host.health`'s `emulator` and in its log) when it is not, or when the library is missing or
cannot be loaded; shells then run without their screen restore. Changing a function, or adding one, raises the number.

## Build and replace

```
cargo build --release
```

builds `target/release/libjaunt_emulator.so` (Rust 1.91 or newer; `Cargo.lock` is here). To use it:

- copy it over the library of your jaunt installation, beside the `jaunt` binary (or in the `lib` folder next to the folder that holds the
  binary), and restart the host; or
- point `jaunt_EMULATOR_LIB` at the file in the host's environment (only that file is then tried).

`jaunt` logs one line at start naming the library it loaded and where from (`terminal emulator: jaunt-emulator 0.0.1 (port of pyte 0.8.2,
ABI 1) from ...`), and `host.health` carries the same as `emulator.library`.

## Which jaunt release uses it

The library in a jaunt host release is built from this folder as the release's source commit had it. This folder is published by the
same sync as the rest of this repository, once for each change of the source's main branch (the commit message names the source commit:
`Sync distribution files (source main <sha>)`), and `SYNCED_FROM` names the one that wrote the folder you are looking at. So the source
of the library in a release is the folder at the sync of that release's source commit, or the last sync before it. The Python host does
not use it (it runs pyte as an installed library, unmodified).

Only this folder of the jaunt source is published here, under the LGPL; the rest of jaunt's source is not.

## Tests

`cargo test` runs the unit tests and an interface round trip. The comparison with the Python host's emulator (a corpus of recorded
terminal output and its digests) is part of jaunt's own source and is not published.
