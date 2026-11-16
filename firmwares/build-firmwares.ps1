<#
.SYNOPSIS
    Single-click script to clone all FM-1 community firmware repositories, update to their
    latest main/master branches, build/retrieve their web native WASM binaries following repo
    instructions, and generate comprehensive interface documentation.

.DESCRIPTION
    Runs across all 25 FM-1 pocket synth community firmwares:
      - fmini-1 (ruppert/fmini-1)
      - melodee (keremimo/melodee)
      - skiff (illuminus5/skiff)
      - Felucca (hugelton/Felucca)
      - fm1-amb (charlesvestal/fm1-amb)
      - obervave (zvenson/obervave)
      - grimm (GRiMMBIENT/grimm)
      - fm1-x0x (charlesvestal/fm1-x0x)
      - niagara-drift (evanyerburgh/niagara-drift)
      - fm1-monk (charlesvestal/fm1-monk)
      - fm1-loom (charlesvestal/fm1-loom)
      - mutable-dreams (kidbee85-beep/mutable-dreams)
      - frasil (styvesgoupil/frasil)
      - CoralFlower (FicusFicusov/CoralFlower)
      - S1Vave (AndrewGG88/S1Vave)
      - zen-1 (aceyprime/zen-1)
      - Arctic-scream-FM-1 (PolarPatch/Arctic-scream-FM-1)
      - fm1-fimba (jadamsowers/fm1-fimba)
      - fm1-aisling (stephencummins/fm1-aisling)
      - SATIE-1 (OCKM-STUDIO/SATIE-1)
      - fm1-nachtfahrt (FartyPants/fm1-nachtfahrt)
      - OG-Synth-source (mikejohnsonbeats/OG-Synth-source)
      - FM1-Animatek (animatek/FM1-Animatek)
      - JIANT (juanjiant-bit/JIANT)
      - Golana (Gadlele/Golana)

.EXAMPLE
    .\build-firmwares.ps1
#>

[CmdletBinding()]
param(
    [switch]$SkipPull = $false,
    [switch]$Clean = $false
)

$ErrorActionPreference = "Stop"
$firmwaresDir = $PSScriptRoot
if (-not $firmwaresDir) { $firmwaresDir = Get-Location }
$distDir = Join-Path $firmwaresDir "dist"
$docsDir = Join-Path $firmwaresDir "docs"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " FM-1 Community Firmwares - Single-Click Build & Documentation" -ForegroundColor Cyan
Write-Host " Target Directory: $firmwaresDir" -ForegroundColor Cyan
Write-Host " Total Firmwares : 25" -ForegroundColor Cyan
Write-Host "=================================================================`n" -ForegroundColor Cyan

if ($Clean -and (Test-Path $distDir)) {
    Write-Host "Cleaning output directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $distDir
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
New-Item -ItemType Directory -Force -Path $docsDir | Out-Null

$repos = @(
    @{ Id = "fmini-1"; Name = "FMini-1"; Url = "https://github.com/ruppert/fmini-1.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "melodee"; Name = "Melodee"; Url = "https://github.com/keremimo/melodee.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "skiff"; Name = "Skiff"; Url = "https://github.com/illuminus5/skiff.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "Felucca"; Name = "Felucca"; Url = "https://github.com/hugelton/Felucca.git"; BuildScript = "tools/build.py" },
    @{ Id = "fm1-amb"; Name = "AMB-1"; Url = "https://github.com/charlesvestal/fm1-amb.git"; BuildScript = "web/app/build.sh" },
    @{ Id = "obervave"; Name = "OberVave"; Url = "https://github.com/zvenson/obervave.git"; BuildScript = "web/sim/build.sh" },
    @{ Id = "grimm"; Name = "GR!MM"; Url = "https://github.com/GRiMMBIENT/grimm.git"; BuildScript = "web/build_web.sh" },
    @{ Id = "fm1-x0x"; Name = "X0X"; Url = "https://github.com/charlesvestal/fm1-x0x.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "niagara-drift"; Name = "Niagara Drift"; Url = "https://github.com/evanyerburgh/niagara-drift.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "fm1-monk"; Name = "MONK-1"; Url = "https://github.com/charlesvestal/fm1-monk.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "fm1-loom"; Name = "Loom"; Url = "https://github.com/charlesvestal/fm1-loom.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "mutable-dreams"; Name = "Mutable Dreams"; Url = "https://github.com/kidbee85-beep/mutable-dreams.git"; BuildScript = "tools/build.py" },
    @{ Id = "frasil"; Name = "FRASIL"; Url = "https://github.com/styvesgoupil/frasil.git"; BuildScript = "build.sh" },
    @{ Id = "CoralFlower"; Name = "CoralFlower"; Url = "https://github.com/FicusFicusov/CoralFlower.git"; BuildScript = "tools/emu/web/build_web.sh" },
    @{ Id = "S1Vave"; Name = "S1Vave"; Url = "https://github.com/AndrewGG88/S1Vave.git"; BuildScript = "web/sim/build.sh" },
    @{ Id = "zen-1"; Name = "ZEN-1"; Url = "https://github.com/aceyprime/zen-1.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "Arctic-scream-FM-1"; Name = "Arctic Scream"; Url = "https://github.com/PolarPatch/Arctic-scream-FM-1.git"; BuildScript = "web/build_web.sh" },
    @{ Id = "fm1-fimba"; Name = "FiMba-1"; Url = "https://github.com/jadamsowers/fm1-fimba.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "fm1-aisling"; Name = "Aisling"; Url = "https://github.com/stephencummins/fm1-aisling.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "SATIE-1"; Name = "SATIE-1"; Url = "https://github.com/OCKM-STUDIO/SATIE-1.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "fm1-nachtfahrt"; Name = "Nachtfahrt"; Url = "https://github.com/FartyPants/fm1-nachtfahrt.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "OG-Synth-source"; Name = "OG Synth"; Url = "https://github.com/mikejohnsonbeats/OG-Synth-source.git"; BuildScript = "" },
    @{ Id = "FM1-Animatek"; Name = "ATEK 303"; Url = "https://github.com/animatek/FM1-Animatek.git"; BuildScript = "atek303/build.sh" },
    @{ Id = "JIANT"; Name = "JIANT"; Url = "https://github.com/juanjiant-bit/JIANT.git"; BuildScript = "web/emu/build.sh" },
    @{ Id = "Golana"; Name = "Golana"; Url = "https://github.com/Gadlele/Golana.git"; BuildScript = "web/emu/build_wasm.sh" }
)

# Step 1: Clone, checkout main/master, and update
Write-Host ">>> [1/3] Cloning and Updating Repositories to Latest main/master..." -ForegroundColor Green

foreach ($r in $repos) {
    $repoPath = Join-Path $firmwaresDir $r.Id
    if (-not (Test-Path $repoPath)) {
        Write-Host "  [CLONE] Cloning $($r.Name) ($($r.Url))..." -ForegroundColor Cyan
        git clone $r.Url $repoPath
    } else {
        Write-Host "  [EXISTS] $($r.Name) already cloned at $repoPath" -ForegroundColor DarkGray
    }

    if (-not $SkipPull) {
        try {
            # Determine target branch (prefer main, then master)
            $branches = git -C $repoPath branch -r
            $targetBranch = "main"
            if ($branches -match "origin/main") {
                $targetBranch = "main"
            } elseif ($branches -match "origin/master") {
                $targetBranch = "master"
            }

            Write-Host "  [UPDATE] Checking out $targetBranch for $($r.Name)..." -ForegroundColor DarkCyan
            git -C $repoPath checkout -q $targetBranch 2>$null
            git -C $repoPath pull -q origin $targetBranch 2>$null

            if (Test-Path (Join-Path $repoPath ".gitmodules")) {
                Write-Host "  [SUBMODULES] Updating submodules for $($r.Name)..." -ForegroundColor DarkGray
                git -C $repoPath submodule update -q --init --recursive 2>$null
            }
        } catch {
            Write-Warning "Could not update $($r.Name): $_"
        }
    }
}

# Step 2: Compile (if toolchain present) & Retrieve Native Web WASM Builds
Write-Host "`n>>> [2/3] Generating / Retrieving Web Native WASM Builds..." -ForegroundColor Green

$hasEmcc = (Get-Command emcc -ErrorAction SilentlyContinue) -ne $null

if ($hasEmcc) {
    foreach ($r in $repos) {
        $repoPath = Join-Path $firmwaresDir $r.Id
        $scriptPath = Join-Path $repoPath $r.BuildScript
        if ($r.BuildScript -and (Test-Path $scriptPath)) {
            Write-Host "  [BUILD] Running repo build instructions for $($r.Name) ($($r.BuildScript))..." -ForegroundColor Cyan
            try {
                if ($r.BuildScript.EndsWith(".py")) {
                    python $scriptPath
                } else {
                    sh $scriptPath
                }
            } catch {
                Write-Warning "Local build attempt for $($r.Name) failed: $_. Falling back to repo web build."
            }
        }
    }
}

$extractScript = Join-Path $firmwaresDir "extract-artifacts.mjs"
if (Test-Path $extractScript) {
    node $extractScript
} else {
    Write-Error "extract-artifacts.mjs not found at $extractScript"
}

# Step 3: Generate Interface Documentation and Manifest
Write-Host "`n>>> [3/3] Generating Interface Documentation and Manifest..." -ForegroundColor Green
$genScript = Join-Path $firmwaresDir "generate-interface-docs.mjs"
if (Test-Path $genScript) {
    node $genScript
} else {
    Write-Error "generate-interface-docs.mjs not found at $genScript"
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host " Finished! All 25 firmwares processed." -ForegroundColor Cyan
Write-Host " WASM Binaries : $distDir" -ForegroundColor Cyan
Write-Host " Documentation : $docsDir and $firmwaresDir\INTERFACES.md" -ForegroundColor Cyan
Write-Host " Manifest      : $distDir\manifest.json" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
