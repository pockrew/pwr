# ==============================================================================
# PWR installer for Windows: downloads the `pwr` CLI and `pwr-agent` daemon for
# this machine from GitHub Releases, verifies their SHA-256 checksums, and
# installs them. Mirrors install.sh.
#
#   irm https://raw.githubusercontent.com/pockrew/pwr/main/install.ps1 | iex
#
# With options:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/pockrew/pwr/main/install.ps1))) -Version v0.2.0
#
# Options:
#   -Version <vX.Y.Z>   Install a specific release (default: latest)
#   -Prefix <dir>       Install directory (default: %LOCALAPPDATA%\Programs\pwr)
#   -FromSource         Build from this checkout with Bun instead of downloading
# ==============================================================================
param(
  [string]$Version = "latest",
  [string]$Prefix = (Join-Path $env:LOCALAPPDATA "Programs\pwr"),
  [switch]$FromSource
)

$ErrorActionPreference = "Stop"
# Invoke-WebRequest is many times slower while it draws a progress bar.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = "pockrew/pwr"

function Write-Info([string]$Message) { Write-Host "* $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "OK $Message" -ForegroundColor Green }
# `throw`, not `exit`: under `irm | iex`, exit would close the user's PowerShell window.
function Stop-Install([string]$Message) { throw "PWR install failed: $Message" }

# 1. Platform: Windows on x64/arm64.
$Arch = $null
try {
  $Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
} catch {
  $Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
}
switch ($Arch) {
  { $_ -in "X64", "AMD64" } { $Arch = "x64" }
  "Arm64" { $Arch = "arm64" }
  default { Stop-Install "unsupported architecture: $Arch" }
}
$Target = "windows-$Arch"
$Names = @("pwr", "pwr-agent")

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("pwr-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  if ($FromSource) {
    # 2a. Source build from a checkout of this repository.
    $Root = $PSScriptRoot
    if (-not $Root -or -not (Test-Path (Join-Path $Root "package.json")) -or -not (Test-Path (Join-Path $Root "apps\agent"))) {
      Stop-Install "-FromSource must run from a PWR checkout (.\install.ps1 -FromSource)"
    }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Stop-Install "-FromSource needs Bun (https://bun.sh)" }
    Write-Info "Building from source in $Root"
    Push-Location $Root
    try {
      bun install --frozen-lockfile
      if ($LASTEXITCODE -ne 0) { Stop-Install "bun install failed" }
      bun scripts/release.ts --target $Target
      if ($LASTEXITCODE -ne 0) { Stop-Install "release build failed" }
    } finally {
      Pop-Location
    }
    foreach ($Name in $Names) {
      Copy-Item (Join-Path $Root "dist\release\$Name-$Target.exe") (Join-Path $Tmp "$Name.exe")
    }
  } else {
    # 2b. Download release assets and verify them against the published checksums.
    $Base = if ($Version -eq "latest") {
      "https://github.com/$Repo/releases/latest/download"
    } else {
      "https://github.com/$Repo/releases/download/$Version"
    }
    Write-Info "Downloading PWR $Version for $Target"
    foreach ($Asset in @($Names | ForEach-Object { "$_-$Target.exe" }) + "SHA256SUMS") {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)
      } catch {
        Stop-Install "download failed: $Base/$Asset"
      }
    }
    $Sums = @{}
    foreach ($Line in Get-Content (Join-Path $Tmp "SHA256SUMS")) {
      $Parts = $Line.Trim() -split "\s+"
      if ($Parts.Count -ge 2) { $Sums[$Parts[1]] = $Parts[0].ToLowerInvariant() }
    }
    foreach ($Name in $Names) {
      $Asset = "$Name-$Target.exe"
      $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLowerInvariant()
      if (-not $Sums.ContainsKey($Asset) -or $Sums[$Asset] -ne $Actual) { Stop-Install "checksum mismatch for $Asset" }
      Move-Item (Join-Path $Tmp $Asset) (Join-Path $Tmp "$Name.exe")
    }
    Write-Ok "Checksums verified"
  }

  # 3. Stop a running agent before replacing its binary; it resumes stored work on next start.
  $Existing = Get-Command pwr -ErrorAction SilentlyContinue
  if ($Existing) { & $Existing.Source agent stop *> $null }

  New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
  foreach ($Name in $Names) {
    $Destination = Join-Path $Prefix "$Name.exe"
    # Leftovers from a Windows self-update, which moves running binaries aside.
    Remove-Item "$Destination.old" -Force -ErrorAction SilentlyContinue
    try {
      Copy-Item -Force (Join-Path $Tmp "$Name.exe") $Destination
    } catch {
      Stop-Install "could not write $Destination; stop pwr-agent (pwr agent stop) and retry"
    }
  }
  Write-Ok "Installed pwr.exe and pwr-agent.exe to $Prefix"
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

# 4. Put the install directory on the user PATH (new terminals pick it up).
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Entries = if ($UserPath) { $UserPath -split ";" } else { @() }
if ($Entries -notcontains $Prefix) {
  [Environment]::SetEnvironmentVariable("Path", (@($Entries | Where-Object { $_ }) + $Prefix) -join ";", "User")
  $env:Path = "$env:Path;$Prefix"
  Write-Info "Added $Prefix to your user PATH; open a new terminal to use pwr there."
}

Write-Host @'

Next steps:
  pwr agent start                     # start the local agent (or: pwr agent install-service)
  $env:RELAY_KEY | pwr connect <slug> --server https://<your-server> --api-key -
  pwr studio                          # open the local inspector
'@
