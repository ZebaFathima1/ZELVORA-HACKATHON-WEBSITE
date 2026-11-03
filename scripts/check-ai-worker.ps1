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
    Write-Host "qwen3-vl:8b: INSTALLED"
    try {
      $chat = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" -Method Post -ContentType "application/json" -TimeoutSec 180 -Body (@{
        model = "qwen3-vl:8b"
        stream = $false
        format = "json"
        messages = @(@{ role = "user"; content = 'Return JSON only: {"ok":true}' })
        options = @{ num_predict = 64; temperature = 0 }
      } | ConvertTo-Json -Depth 5)
      $content = [string]$chat.message.content
      $thinking = ""
      if ($chat.message.PSObject.Properties.Name -contains "thinking") {
        $thinking = [string]$chat.message.thinking
      }
      if (-not [string]::IsNullOrWhiteSpace($content) -or -not [string]::IsNullOrWhiteSpace($thinking)) {
        Write-Host "qwen3-vl:8b: READY (chat smoke test passed)"
      } else {
        Write-Host "qwen3-vl:8b: INSTALLED but chat smoke test returned empty content"
      }
    } catch {
      Write-Host "qwen3-vl:8b: INSTALLED but chat smoke test failed"
    }
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
