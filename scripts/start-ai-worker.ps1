$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $root "ai-worker"
$pidFile = Join-Path $workerDir ".worker.pid"
$envFile = Join-Path $workerDir ".env"
$logFile = Join-Path $workerDir "worker.log"
$errFile = Join-Path $workerDir "worker-error.log"
$stopFile = Join-Path $workerDir ".stop-worker"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing ai-worker\.env. Copy ai-worker\.env.example to ai-worker\.env and configure it first."
}
if (Test-Path -LiteralPath $pidFile) {
  $savedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  $existing = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if ($existing) {
    throw "The AI worker already appears to be running (PID $savedPid). Run .\scripts\check-ai-worker.ps1."
  }
  Remove-Item -LiteralPath $pidFile -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $workerDir "node_modules\tsx\dist\cli.mjs"))) {
  throw "Worker dependencies are missing. Run: npm --prefix ai-worker install"
}

$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
  throw "Ollama CLI was not found. Install Ollama, then run ollama serve."
}
try {
  $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
} catch {
  Start-Process -FilePath $ollamaCommand.Source -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 3
  $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
}
if (-not ($tags.models | Where-Object { $_.name -like "qwen3-vl:8b*" })) {
  throw "Model qwen3-vl:8b is not available. Run: ollama pull qwen3-vl:8b"
}
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile -Force }

$node = Get-Command node -ErrorAction Stop
$process = Start-Process -FilePath $node.Source `
  -ArgumentList @(".\node_modules\tsx\dist\cli.mjs", ".\src\index.ts") `
  -WorkingDirectory $workerDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logFile `
  -RedirectStandardError $errFile `
  -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id
Start-Sleep -Seconds 2
if ($process.HasExited) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  throw "The worker exited during startup. Check ai-worker\worker-error.log."
}
Write-Host "AI worker started (PID $($process.Id)). Ollama stays on localhost; no public Ollama port is opened."
Write-Host "Check status with: .\scripts\check-ai-worker.ps1"
