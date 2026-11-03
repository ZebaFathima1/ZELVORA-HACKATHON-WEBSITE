$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $root "ai-worker"
$pidFile = Join-Path $workerDir ".worker.pid"
$stopFile = Join-Path $workerDir ".stop-worker"

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host "No worker PID file was found; the worker may already be stopped."
  exit 0
}
$savedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
$process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host "Worker process is already stopped."
  exit 0
}

Set-Content -LiteralPath $stopFile -Value "stop"
Write-Host "Requested graceful shutdown. The worker will finish its current model request before stopping."
for ($attempt = 0; $attempt -lt 900; $attempt++) {
  Start-Sleep -Seconds 1
  $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "AI worker stopped. Ollama and saved job state were left untouched."
    exit 0
  }
}

Write-Warning "Worker is still finishing a request. It was not force-killed; check ai-worker\worker.log and retry this script later."
