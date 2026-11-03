$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $root "ai-worker"
$pidFile = Join-Path $workerDir ".worker.pid"
$logFile = Join-Path $workerDir "worker.log"
$errFile = Join-Path $workerDir "worker-error.log"

if (Test-Path -LiteralPath $pidFile) {
  $savedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if ($process) { Write-Host "Worker process: ONLINE (PID $savedPid)" }
  else { Write-Host "Worker process: OFFLINE (stale PID file)" }
} else {
  Write-Host "Worker process: OFFLINE"
}

try {
  $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
  Write-Host "Ollama API: CONNECTED"
  if ($tags.models | Where-Object { $_.name -like "qwen3-vl:8b*" }) {
    Write-Host "qwen3-vl:8b: AVAILABLE"
  } else {
    Write-Host "qwen3-vl:8b: MISSING (run ollama pull qwen3-vl:8b)"
  }
} catch {
  Write-Host "Ollama API: DISCONNECTED (start Ollama and retry)"
}

if (Test-Path -LiteralPath $errFile) {
  Write-Host "`nRecent worker errors:"
  Get-Content -LiteralPath $errFile -Tail 12
}
if (Test-Path -LiteralPath $logFile) {
  Write-Host "`nRecent worker activity:"
  Get-Content -LiteralPath $logFile -Tail 12
}
