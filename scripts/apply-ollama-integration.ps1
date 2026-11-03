# Applies the pending Qwen3-VL / local-worker integration to the linked Supabase project.
# Requires explicit confirmation because this mutates production.
#
# Target: linked project only (expected mijzlufjpmoyluhwzrgh).
# Secrets written: AI_WORKER_SECRET, ALLOWED_ORIGIN only.
# Does not print secret values.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$expectedRef = "mijzlufjpmoyluhwzrgh"
$linkedRefPath = Join-Path $root "supabase\.temp\project-ref"
if (-not (Test-Path -LiteralPath $linkedRefPath)) {
  throw "No linked Supabase project-ref found."
}
$linkedRef = (Get-Content -LiteralPath $linkedRefPath -Raw).Trim()
if ($linkedRef -ne $expectedRef) {
  throw "Refusing to proceed: linked project is '$linkedRef', expected '$expectedRef'."
}

Write-Host "1/4 Preparing worker env and secrets file from .env.local (values not printed)..."
& "$PSScriptRoot\setup-worker-env.ps1"

$secretsFile = Join-Path $root "ai-worker\.supabase-secrets.env"
if (-not (Test-Path -LiteralPath $secretsFile)) {
  throw "Missing ai-worker\.supabase-secrets.env. Run scripts\setup-worker-env.ps1 first."
}

# Validate secrets file contains only the two intended keys (names only).
$secretKeys = @()
Get-Content -LiteralPath $secretsFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { $secretKeys += $matches[1] }
}
$allowedKeys = @("AI_WORKER_SECRET", "ALLOWED_ORIGIN")
foreach ($key in $secretKeys) {
  if ($allowedKeys -notcontains $key) {
    throw "Refusing secrets file: unexpected key '$key'. Only AI_WORKER_SECRET and ALLOWED_ORIGIN are allowed."
  }
}
foreach ($required in $allowedKeys) {
  if ($secretKeys -notcontains $required) {
    throw "Secrets file missing required key '$required'."
  }
}

Write-Host "2/4 Applying pending remote migrations (202611030001, 202611030002) to $expectedRef..."
npx supabase db push --remote --yes
if ($LASTEXITCODE -ne 0) { throw "db push failed" }

Write-Host "3/4 Setting Edge Function secrets AI_WORKER_SECRET and ALLOWED_ORIGIN only..."
npx supabase secrets set --env-file $secretsFile --yes
if ($LASTEXITCODE -ne 0) { throw "secrets set failed" }

Write-Host "4/4 Deploying functions that need the local-worker endpoints and/or updated CORS allowlist..."
# test-ai-provider intentionally omitted: frontend uses ai-worker-status for Test AI connection.
# Retired hosted-provider stubs (start-evaluation, process-evaluation, evaluate-project) omitted.
# verify-team / submit-project included so participant CORS uses the same secure allowlist (shared http.ts).
$functions = @(
  "ai-worker-control",
  "ai-worker-status",
  "start-ai-evaluation",
  "evaluation-status",
  "finalize-leaderboard",
  "verify-team",
  "submit-project"
)
foreach ($name in $functions) {
  Write-Host "  deploying $name..."
  npx supabase functions deploy $name --yes
  if ($LASTEXITCODE -ne 0) { throw "Deploy failed for $name" }
}

Write-Host ""
Write-Host "Remote integration applied to $expectedRef."
Write-Host "Next:"
Write-Host "  .\scripts\start-ai-worker.ps1"
Write-Host "  .\scripts\check-ai-worker.ps1"
Write-Host "  Open /organizer -> AI Evaluation -> Test AI connection"
Write-Host "If production browser CORS fails, append https://YOUR_DOMAIN to ALLOWED_ORIGIN and re-run secrets set + redeploy the functions above."
