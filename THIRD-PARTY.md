# Third-party code

## fm1-emu

The emulator: the `fm1-core`, `fm1-isa` and `fm1-soc` crates (a pinned git dependency, see
`Cargo.toml`), and the JIT's host side in `ui/web/player-worklet.js` (`jitImports`),
adapted from its `web/jit.js`.

https://github.com/joakimeriksson/fm1-emu

```
MIT License

Copyright (c) 2026 Joakim Eriksson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Firmware

Firmware packages are not part of this project and are never distributed with it. Each is
downloaded by the user from its author's GitHub release, and remains under its author's
licence.
