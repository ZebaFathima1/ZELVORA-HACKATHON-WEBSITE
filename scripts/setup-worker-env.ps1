$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$workerEnv = Join-Path $root "ai-worker\.env"
$envLocal = Join-Path $root ".env.local"
$secretsFile = Join-Path $root "ai-worker\.supabase-secrets.env"
$hint = Join-Path $root "ai-worker\.supabase-secret-to-set.txt"

function Get-EnvMap([string]$path) {
  $map = @{}
  Get-Content -LiteralPath $path | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $map[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $map
}

function New-WorkerSecret {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

if (-not (Test-Path -LiteralPath $envLocal)) {
  throw "Missing .env.local"
}

$map = Get-EnvMap $envLocal
$url = $map["NEXT_PUBLIC_SUPABASE_URL"]
$anon = $map["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
if (-not $anon) { $anon = $map["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] }
if (-not $url) { throw "Missing NEXT_PUBLIC_SUPABASE_URL" }
if (-not $anon) { throw "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" }

$existingSecret = $null
$existingAllowed = $null
if (Test-Path -LiteralPath $workerEnv) {
  $existing = Get-EnvMap $workerEnv
  if ($existing["AI_WORKER_SECRET"] -and $existing["AI_WORKER_SECRET"].Length -ge 16) {
    $existingSecret = $existing["AI_WORKER_SECRET"]
  }
}
if (Test-Path -LiteralPath $secretsFile) {
  $existingSecrets = Get-EnvMap $secretsFile
  if ($existingSecrets["AI_WORKER_SECRET"] -and $existingSecrets["AI_WORKER_SECRET"].Length -ge 16) {
    $existingSecret = $existingSecrets["AI_WORKER_SECRET"]
  }
  if ($existingSecrets["ALLOWED_ORIGIN"]) {
    $existingAllowed = $existingSecrets["ALLOWED_ORIGIN"]
  }
}

$secret = if ($existingSecret) { $existingSecret } else { New-WorkerSecret }

# Explicit multi-origin allowlist (comma-separated). Append production HTTPS origin when known.
# Merge prior ALLOWED_ORIGIN entries with required localhost ports; never use "*".
$originSet = [System.Collections.Generic.List[string]]::new()
if ($existingAllowed) {
  foreach ($part in ($existingAllowed -split ",")) {
    $trimmed = $part.Trim()
    if ($trimmed -and $trimmed -ne "*" -and -not $originSet.Contains($trimmed)) {
      $originSet.Add($trimmed)
    }
  }
}
foreach ($localOrigin in @(
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001"
)) {
  if (-not $originSet.Contains($localOrigin)) { $originSet.Add($localOrigin) }
}
# Strip any accidental wildcard; production HTTPS can be appended later by the operator.
$originSet.Remove("*") | Out-Null
$allowedOrigin = ($originSet -join ",")

@(
  "SUPABASE_URL=$url"
  "SUPABASE_ANON_KEY=$anon"
  "AI_WORKER_SECRET=$secret"
  "OLLAMA_BASE_URL=http://127.0.0.1:11434"
  "OLLAMA_MODEL=qwen3-vl:8b"
  "OLLAMA_TIMEOUT_MS=900000"
  "OLLAMA_KEEP_ALIVE=10m"
  "WORKER_DISPLAY_NAME=Zelvora Windows Worker"
) | Set-Content -LiteralPath $workerEnv -Encoding UTF8

# Only the two Edge Function secrets we intentionally manage.
@(
  "AI_WORKER_SECRET=$secret"
  "ALLOWED_ORIGIN=$allowedOrigin"
) | Set-Content -LiteralPath $secretsFile -Encoding UTF8

@(
  "Set this EXACT value as Supabase Edge Function secret AI_WORKER_SECRET (do not commit):"
  $secret
  ""
  "ALLOWED_ORIGIN currently:"
  $allowedOrigin
  ""
  "To add production, edit ai-worker/.supabase-secrets.env and append:"
  "  ,https://YOUR_PRODUCTION_DOMAIN"
  "Example:"
  "  ALLOWED_ORIGIN=http://localhost:3000,http://localhost:3001,https://hackathon.example.com"
  ""
  "Dashboard: Project Settings -> Edge Functions -> Secrets"
  "Delete this file after configuring Supabase."
) | Set-Content -LiteralPath $hint -Encoding UTF8

$hostName = ([Uri]$url).Host
Write-Host "WORKER_ENV_OK secret_len=$($secret.Length) host=$hostName preserved_existing=$([bool]$existingSecret)"
Write-Host "ALLOWED_ORIGIN_CONFIGURED (values not printed beyond localhost defaults check)"
if ($allowedOrigin -notmatch "https://") {
  Write-Host "NOTE: No https production origin in ALLOWED_ORIGIN yet. Append your deployed domain before production browser testing."
}
