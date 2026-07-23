<#
.SYNOPSIS
  kaRAGan installer for Windows — guarantees a COMPLETE install (KJR-TSK-0138).

.DESCRIPTION
  Run it with:
    irm https://rag.karajancode.com/install.ps1 | iex

  npm-first route — the full product (CLI + default LanceDB store):
    1. Node >= 18 present  -> npm install -g karajan-rag @lancedb/lancedb
    2. No usable Node      -> auto-provision the official Node LTS zip into
       ~\.karajan-rag\node (checksum-verified, nothing system-wide touched),
       install with it, drop a karajan-rag wrapper into the install dir and
       add it to the user PATH.
  The default store peer (@lancedb/lancedb) is part of a COMPLETE install:
  without it, `karajan-rag index` with defaults cannot run. Package-only
  install (you provide your own store): set $env:KJR_NO_STORE = "1".

  Env overrides (irm|iex cannot take parameters): KJR_VERSION,
  KJR_INSTALL_DIR, KJR_NO_STORE. Windows PowerShell 5.1 compatible.
#>
$ErrorActionPreference = "Stop"

$version = if ($env:KJR_VERSION) { $env:KJR_VERSION } else { "latest" }
$installDir = if ($env:KJR_INSTALL_DIR) { $env:KJR_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "KarajanRag" }
$withStore = ($env:KJR_NO_STORE -ne "1")
$nodeMinMajor = 18
$provisionMajor = 22

function Get-NpmPkgs {
  $pkg = if ($version -eq "latest") { "karajan-rag" } else { "karajan-rag@" + $version.TrimStart("v") }
  if ($withStore) { @($pkg, "@lancedb/lancedb") } else { @($pkg) }
}

function Write-StoreNote {
  if (-not $withStore) {
    Write-Host "kjr-install: NOTE - installed WITHOUT the default store (KJR_NO_STORE=1). 'karajan-rag index' with defaults will fail until you provide a store (@lancedb/lancedb or --store pgvector)."
  }
}

function Test-NodeOk {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $v = (& node --version) 2>$null
  if (-not $v) { return $false }
  $major = [int]$v.TrimStart("v").Split(".")[0]
  return ($major -ge $nodeMinMajor)
}

function Add-UserPath([string]$dir) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($userPath) { $parts = $userPath.Split(";") | Where-Object { $_ -ne "" } }
  $already = $parts | Where-Object { $_.TrimEnd("\") -ieq $dir.TrimEnd("\") }
  if (-not $already) {
    $newPath = if ($userPath) { "$userPath;$dir" } else { $dir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "kjr-install: added '$dir' to your user PATH. Open a NEW terminal to use 'karajan-rag'."
  }
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("kjr-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
  if (Test-NodeOk) {
    Write-Host "kjr-install: Node $(& node --version) found - installing via npm (full product)..."
    & npm install -g @(Get-NpmPkgs)
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    Write-Host "kjr-install: installed. Run 'karajan-rag doctor' next, then point it at a corpus: 'karajan-rag init .'"
    Write-StoreNote
    return
  }

  Write-Host "kjr-install: no usable Node (need >= $nodeMinMajor) - provisioning official Node LTS into ~\.karajan-rag\node (nothing system-wide)..."
  $dist = "https://nodejs.org/dist/latest-v$provisionMajor.x"
  $shaFile = Join-Path $tmp "SHASUMS256.txt"
  Invoke-WebRequest -Uri "$dist/SHASUMS256.txt" -OutFile $shaFile -UseBasicParsing
  $shaLines = Get-Content $shaFile
  $assetLine = $shaLines | Where-Object { $_ -match "node-v[0-9.]+-win-x64\.zip" } | Select-Object -First 1
  if (-not $assetLine) { throw "no official Node build for win-x64 in $dist" }
  $nodeAsset = ($assetLine -split "\s+")[1]
  $expected = ($assetLine -split "\s+")[0].ToLower()

  Write-Host "kjr-install: downloading $nodeAsset..."
  $zip = Join-Path $tmp $nodeAsset
  Invoke-WebRequest -Uri "$dist/$nodeAsset" -OutFile $zip -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($expected -ne $actual) { throw "Node checksum mismatch - aborting, nothing installed." }

  # Stage everything (extract + npm install) and only swap into place once
  # EVERYTHING succeeded - a failure must never destroy a previous working
  # ~\.karajan-rag\node.
  $nodeHome = Join-Path $env:USERPROFILE ".karajan-rag\node"
  $staging = "$nodeHome.staging.$PID"
  $extract = Join-Path $tmp "extract"
  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
  Expand-Archive -Path $zip -DestinationPath $extract -Force
  # The zip wraps everything in a node-vX.Y.Z-win-x64\ top folder - unwrap it.
  $inner = Get-ChildItem -Directory $extract | Select-Object -First 1
  New-Item -ItemType Directory -Path (Split-Path $staging) -Force | Out-Null
  Move-Item -Path $inner.FullName -Destination $staging

  Write-Host "kjr-install: installing karajan-rag with the provisioned Node..."
  $env:Path = "$staging;$env:Path"
  # Explicit --prefix: the official Windows npm ships a builtin prefix of
  # %AppData%\npm - without this the global shims would land OUTSIDE the
  # self-contained ~\.karajan-rag\node home (on Windows, prefix root IS the
  # global bin dir, so shims land at $staging\karajan-rag.cmd).
  & (Join-Path $staging "npm.cmd") install -g --prefix "$staging" @(Get-NpmPkgs)
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with the provisioned Node (exit $LASTEXITCODE)." }
  if (-not (Test-Path (Join-Path $staging "karajan-rag.cmd"))) {
    throw "npm reported success but the karajan-rag shim is missing from the staged prefix. Aborting, nothing swapped."
  }

  # Swap keeping the previous install recoverable: park it as a backup,
  # move the staged one in, restore the backup if that move fails.
  $backup = "$nodeHome.old.$PID"
  if (Test-Path $nodeHome) { Move-Item -Path $nodeHome -Destination $backup -Force }
  try {
    Move-Item -Path $staging -Destination $nodeHome
  } catch {
    if (Test-Path $backup) { Move-Item -Path $backup -Destination $nodeHome -Force }
    throw "could not move the staged install into place (previous install restored). $_"
  }
  if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }

  # Wrapper, not a copy: npm's own .cmd shim lives inside nodeHome and
  # resolves node via its folder; this puts nodeHome on PATH for children
  # and forwards every argument.
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $shim = Join-Path $nodeHome "karajan-rag.cmd"
  $wrapper = @(
    "@echo off",
    "set `"PATH=$nodeHome;%PATH%`"",
    "`"$shim`" %*"
  )
  Set-Content -Path (Join-Path $installDir "karajan-rag.cmd") -Value $wrapper -Encoding ASCII
  Add-UserPath $installDir
  $installed = (& (Join-Path $installDir "karajan-rag.cmd") --version) 2>$null
  Write-Host "kjr-install: installed karajan-rag $installed (full product) - bin at $(Join-Path $installDir 'karajan-rag.cmd')"
  Write-StoreNote
  Write-Host "kjr-install: next - run 'karajan-rag doctor', then point it at a corpus: 'karajan-rag init .'"
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
