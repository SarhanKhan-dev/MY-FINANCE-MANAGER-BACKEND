# Copies this repo's .env values into the linked Vercel project (production + preview).
#
# One-time setup, run from the repo root:
#   npx vercel login          — sign in (opens browser)
#   npx vercel link           — pick the MY-FINANCE-MANAGER-BACKEND project
# Then:
#   powershell -ExecutionPolicy Bypass -File scripts/push-env-to-vercel.ps1
#
# Seed-only variables (SUPERADMIN_*, USER1_*) and empty values are skipped —
# seeding runs locally, never on Vercel.

param([string[]]$Environments = @("production", "preview"))

if (-not (Test-Path .env)) {
  Write-Error "No .env file here — run this from the repo root."
  exit 1
}

$skipPrefixes = @("SUPERADMIN_", "USER1_")

foreach ($line in Get-Content .env) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }

  $name, $value = $trimmed -split "=", 2
  $name = $name.Trim()
  if (-not $value) {
    Write-Host "skipped $name (empty)"
    continue
  }
  if ($skipPrefixes | Where-Object { $name.StartsWith($_) }) {
    Write-Host "skipped $name (seed-only, local)"
    continue
  }

  foreach ($environment in $Environments) {
    npx vercel env rm $name $environment --yes 2>$null | Out-Null
    $value | npx vercel env add $name $environment
    if ($LASTEXITCODE -eq 0) {
      Write-Host "set $name ($environment)"
    } else {
      Write-Warning "failed to set $name ($environment)"
    }
  }
}

Write-Host ""
Write-Host "Done. Redeploy the project so the new values take effect."
