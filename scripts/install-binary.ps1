<#
.SYNOPSIS
  Karajan Code — standalone binary installer for Windows (no Node required).

.DESCRIPTION
  Downloads the prebuilt kj.exe for Windows x64 from the GitHub release,
  verifies its SHA256 checksum, installs it to %LOCALAPPDATA%\Karajan, and
  adds that folder to the user PATH (idempotently). Re-running updates the
  binary in place without duplicating PATH entries.

  Run it with:
    irm https://karajancode.com/install.ps1 | iex

  Override with env vars: $env:KJ_VERSION (e.g. v3.7.2), $env:KJ_INSTALL_DIR.

  KJC-TSK-0594.
#>
$ErrorActionPreference = "Stop"

$repo = "manufosela/karajan-code"
$version = if ($env:KJ_VERSION) { $env:KJ_VERSION } else { "latest" }
$installDir = if ($env:KJ_INSTALL_DIR) { $env:KJ_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Karajan" }
$asset = "kj-win-x64.exe"

if ($version -eq "latest") {
  $base = "https://github.com/$repo/releases/latest/download"
} else {
  $base = "https://github.com/$repo/releases/download/$version"
}

# Download to a temp folder; only install once the checksum matches, so a
# failure never leaves a half-installed binary behind.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("kj-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $binTmp = Join-Path $tmp "kj.exe"
  $shaTmp = Join-Path $tmp "kj.exe.sha256"

  Write-Host "kj-install: downloading $asset ($version)..."
  try {
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $binTmp -UseBasicParsing
    Invoke-WebRequest -Uri "$base/$asset.sha256" -OutFile $shaTmp -UseBasicParsing
  } catch {
    throw "could not download $base/$asset — does that version/asset exist, and is the network reachable? ($_)"
  }

  # certutil writes a multi-line file; keep only the hex of the hash line.
  $shaLine = (Get-Content $shaTmp | Where-Object { $_ -notmatch "SHA256|CertUtil" } | Select-Object -First 1)
  $expected = ($shaLine -replace "[^0-9A-Fa-f]", "").ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $binTmp).Hash.ToLower()
  if ($expected.Length -ne 64 -or $expected -ne $actual) {
    throw "checksum mismatch (expected '$expected', got '$actual'). Aborting, nothing installed."
  }

  # Install: move into place, replacing any previous install (idempotent).
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $dest = Join-Path $installDir "kj.exe"
  Move-Item -Path $binTmp -Destination $dest -Force

  $installed = (& $dest --version) 2>$null
  Write-Host "kj-install: installed kj $installed to $dest"

  # Add to the user PATH only if it is not already there (no duplicates).
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($userPath) { $parts = $userPath.Split(";") | Where-Object { $_ -ne "" } }
  $already = $parts | Where-Object { $_.TrimEnd("\") -ieq $installDir.TrimEnd("\") }
  if (-not $already) {
    $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "kj-install: added '$installDir' to your user PATH. Open a new terminal to use 'kj'."
  } else {
    Write-Host "kj-install: '$installDir' is already on your user PATH — run 'kj --help' to get started."
  }
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
