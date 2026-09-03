<#
.SYNOPSIS
  Karajan Code installer for Windows — guarantees a COMPLETE install (KJC-TSK-0667).

.DESCRIPTION
  Run it with:
    irm https://karajancode.com/install.ps1 | iex

  Default route: npm — the full product (CLI + RAG + HU Board + MCP).
    1. Node >= 22.12 present  -> npm install -g karajan-code
    2. No usable Node         -> auto-provision the official Node LTS zip into
       ~\.karajan\node (checksum-verified, nothing system-wide touched),
       install karajan-code with it, drop kj/karajan-mcp wrappers into the
       install dir and add it to the user PATH.
  Standalone route (CLI only, no native-module features — RAG/board/MCP
  unavailable): opt-in with $env:KJ_STANDALONE = "1".

  Env overrides (irm|iex cannot take parameters): KJ_VERSION, KJ_INSTALL_DIR,
  KJ_STANDALONE. Windows PowerShell 5.1 compatible.
#>
$ErrorActionPreference = "Stop"

$repo = "manufosela/karajan-code"
$version = if ($env:KJ_VERSION) { $env:KJ_VERSION } else { "latest" }
$installDir = if ($env:KJ_INSTALL_DIR) { $env:KJ_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Karajan" }
$mode = if ($env:KJ_STANDALONE -eq "1") { "standalone" } else { "full" }
$nodeMajor = 22
$nodeMinMinor = 12

function Get-NpmPkg {
  if ($version -eq "latest") { "karajan-code" } else { "karajan-code@" + $version.TrimStart("v") }
}

function Test-NodeOk {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $v = (& node --version) 2>$null
  if (-not $v) { return $false }
  $parts = $v.TrimStart("v").Split(".")
  $major = [int]$parts[0]; $minor = [int]$parts[1]
  return ($major -gt $nodeMajor) -or ($major -eq $nodeMajor -and $minor -ge $nodeMinMinor)
}

function Add-UserPath([string]$dir) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($userPath) { $parts = $userPath.Split(";") | Where-Object { $_ -ne "" } }
  $already = $parts | Where-Object { $_.TrimEnd("\") -ieq $dir.TrimEnd("\") }
  if (-not $already) {
    $newPath = if ($userPath) { "$userPath;$dir" } else { $dir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "kj-install: added '$dir' to your user PATH. Open a NEW terminal to use 'kj'."
  }
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("kj-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
  if ($mode -eq "full") {
    if (Test-NodeOk) {
      Write-Host "kj-install: Node $(& node --version) found — installing via npm (full product)..."
      & npm install -g (Get-NpmPkg)
      if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
      Write-Host ""
      Write-Host "  Listo. Ahora escribe:  kj go"
      Write-Host ""
      Write-Host "  (avanzado: 'kj doctor' revisa la instalacion, 'kj install-tools' completa el stack)"
      return
    }

    Write-Host "kj-install: no usable Node (need >= $nodeMajor.$nodeMinMinor) — provisioning official Node LTS into ~\.karajan\node (nothing system-wide)..."
    $dist = "https://nodejs.org/dist/latest-v$nodeMajor.x"
    $shaFile = Join-Path $tmp "SHASUMS256.txt"
    Invoke-WebRequest -Uri "$dist/SHASUMS256.txt" -OutFile $shaFile -UseBasicParsing
    $shaLines = Get-Content $shaFile
    $assetLine = $shaLines | Where-Object { $_ -match "node-v[0-9.]+-win-x64\.zip" } | Select-Object -First 1
    if (-not $assetLine) { throw "no official Node build for win-x64 in $dist" }
    $nodeAsset = ($assetLine -split "\s+")[1]
    $expected = ($assetLine -split "\s+")[0].ToLower()

    Write-Host "kj-install: downloading $nodeAsset..."
    $zip = Join-Path $tmp $nodeAsset
    Invoke-WebRequest -Uri "$dist/$nodeAsset" -OutFile $zip -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
    if ($expected -ne $actual) { throw "Node checksum mismatch — aborting, nothing installed." }

    # Stage everything (extract + npm install) and only swap into place once
    # EVERYTHING succeeded — a failure must never destroy a previous working
    # ~\.karajan\node.
    $nodeHome = Join-Path $env:USERPROFILE ".karajan\node"
    $staging = "$nodeHome.staging.$PID"
    $extract = Join-Path $tmp "extract"
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    # The zip wraps everything in a node-vX.Y.Z-win-x64\ top folder — unwrap it.
    $inner = Get-ChildItem -Directory $extract | Select-Object -First 1
    New-Item -ItemType Directory -Path (Split-Path $staging) -Force | Out-Null
    Move-Item -Path $inner.FullName -Destination $staging

    Write-Host "kj-install: installing karajan-code with the provisioned Node..."
    $env:Path = "$staging;$env:Path"
    # Explicit --prefix: the official Windows npm ships a builtin prefix of
    # %AppData%\npm — without this the global shims would land OUTSIDE the
    # self-contained ~\.karajan\node home (on Windows, prefix root IS the
    # global bin dir, so shims land at $staging\kj.cmd).
    & (Join-Path $staging "npm.cmd") install -g --prefix "$staging" (Get-NpmPkg)
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with the provisioned Node (exit $LASTEXITCODE)." }
    foreach ($bin in @("kj", "karajan-mcp")) {
      if (-not (Test-Path (Join-Path $staging "$bin.cmd"))) {
        throw "npm reported success but the $bin shim is missing from the staged prefix — the full product needs both kj and karajan-mcp. Aborting, nothing swapped."
      }
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

    # Wrappers, not copies: npm's own .cmd shims live inside nodeHome and
    # resolve node via their folder; these put nodeHome on PATH for children
    # (kj spawns node tooling) and forward every argument.
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    foreach ($bin in @("kj", "karajan-mcp")) {
      $shim = Join-Path $nodeHome "$bin.cmd"
      $wrapper = @(
        "@echo off",
        "set `"PATH=$nodeHome;%PATH%`"",
        "`"$shim`" %*"
      )
      Set-Content -Path (Join-Path $installDir "$bin.cmd") -Value $wrapper -Encoding ASCII
    }
    Add-UserPath $installDir
    $installed = (& (Join-Path $installDir "kj.cmd") --version) 2>$null
    Write-Host "kj-install: installed kj $installed (full product) — kj at $(Join-Path $installDir 'kj.cmd')"
    Write-Host ""
    Write-Host "  Listo. Ahora escribe:  kj go"
    Write-Host ""
    Write-Host "  (avanzado: 'kj doctor' revisa la instalacion, 'kj install-tools' completa el stack)"
    return
  }

  # --- Standalone route: prebuilt single binary (CLI only). ---
  Write-Host "kj-install: standalone mode — single binary, NO native-module features (RAG, HU Board and MCP need the npm install)."
  $asset = "kj-win-x64.exe"
  $base = if ($version -eq "latest") { "https://github.com/$repo/releases/latest/download" }
          else { "https://github.com/$repo/releases/download/$version" }

  $binTmp = Join-Path $tmp "kj.exe"
  $shaTmp = Join-Path $tmp "kj.exe.sha256"
  Write-Host "kj-install: downloading $asset ($version)..."
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $binTmp -UseBasicParsing
  Invoke-WebRequest -Uri "$base/$asset.sha256" -OutFile $shaTmp -UseBasicParsing

  $shaLine = (Get-Content $shaTmp | Where-Object { $_ -notmatch "SHA256|CertUtil" } | Select-Object -First 1)
  $expected = ($shaLine -replace "[^0-9A-Fa-f]", "").ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $binTmp).Hash.ToLower()
  if ($expected.Length -ne 64 -or $expected -ne $actual) {
    throw "checksum mismatch (expected '$expected', got '$actual'). Aborting, nothing installed."
  }

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $dest = Join-Path $installDir "kj.exe"
  Move-Item -Path $binTmp -Destination $dest -Force
  # Clear the mark-of-the-web on the copy we just checksum-verified ourselves.
  Unblock-File -Path $dest -ErrorAction SilentlyContinue
  Add-UserPath $installDir
  $installed = (& $dest --version) 2>$null
  Write-Host "kj-install: installed standalone kj $installed to $dest"
  Write-Host ""
  Write-Host "  Listo. Ahora escribe:  kj go"
  Write-Host ""
  Write-Host "  (avanzado: 'kj doctor' revisa la instalacion; para el producto completo, re-ejecuta sin KJ_STANDALONE)"
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
