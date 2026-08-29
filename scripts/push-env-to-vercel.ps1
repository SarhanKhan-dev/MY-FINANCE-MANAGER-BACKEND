# Copies this repo's .env values into the linked Vercel project (production + preview).
#
# One-time setup, run from the repo root:
#   npx vercel login          - sign in (opens browser)
#   npx vercel link           - pick the project
# Then:
#   powershell -ExecutionPolicy Bypass -File scripts/push-env-to-vercel.ps1
#
# Seed-only variables (SUPERADMIN_*, USER1_*) and empty values are skipped -
# seeding runs locally, never on Vercel.
#
# Values are fed to the CLI through a temp file with cmd's < redirection, not a
# PowerShell pipe: the pipe re-encodes stdin and appends CRLF, which corrupts
# the stored secret (Prisma then rejects DATABASE_URL at runtime).

param([string[]]$Environments = @("production", "preview"))

if (-not (Test-Path .env)) {
  Write-Error "No .env file here - run this from the repo root."
  exit 1
}

$skipPrefixes = @("SUPERADMIN_", "USER1_")
$tempFile = Join-Path ([IO.Path]::GetTempPath()) ("vercel-env-" + [guid]::NewGuid().ToString("N") + ".tmp")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try {
  foreach ($line in Get-Content .env -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }

    $name, $value = $trimmed -split "=", 2
    $name = $name.Trim()
    if (-not $value) {
      Write-Host "skipped $name (empty)"
      continue
    }
    $isSeedOnly = $false
    foreach ($prefix in $skipPrefixes) {
      if ($name.StartsWith($prefix)) { $isSeedOnly = $true }
    }
    if ($isSeedOnly) {
      Write-Host "skipped $name (seed-only, local)"
      continue
    }

    # Exact bytes, no trailing newline, no BOM.
    [IO.File]::WriteAllText($tempFile, $value, $utf8NoBom)

    foreach ($environment in $Environments) {
      cmd /c "npx vercel env rm $name $environment --yes <nul >nul 2>nul"
      cmd /c "npx vercel env add $name $environment < `"$tempFile`"" | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "set $name ($environment)"
      } else {
        Write-Warning "failed to set $name ($environment)"
      }
    }
  }
} finally {
  if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
}

Write-Host ""
Write-Host "Done. Redeploy the project so the new values take effect."
