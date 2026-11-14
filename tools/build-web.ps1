# Build the browser's player: target/wasm/wasm32-unknown-unknown/release/fma_wasm.wasm,
# which the web server serves as /fma_wasm.wasm.
#   rustup target add wasm32-unknown-unknown   (once)
#   tools\build-web.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
# The function table exported and growable: the emulator's JIT installs compiled blocks in
# it (ui/web/player-worklet.js). One codegen unit and a higher inline threshold, as fm1-emu builds its own.
$env:RUSTFLAGS = '-Clink-arg=--export-table -Clink-arg=--growable-table -Cllvm-args=-inline-threshold=2000'
$env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '1'
cargo build --release -p fma-wasm --target wasm32-unknown-unknown --target-dir target/wasm
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-Item target/wasm/wasm32-unknown-unknown/release/fma_wasm.wasm | Select-Object Name, Length
