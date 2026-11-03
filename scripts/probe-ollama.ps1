$ErrorActionPreference = "Stop"

Write-Host "Checking Ollama tags..."
$tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 10
$names = @($tags.models | ForEach-Object { $_.name })
Write-Host ("MODELS=" + ($names -join ","))
if (-not ($names | Where-Object { $_ -like "qwen3-vl:8b*" })) {
  throw "qwen3-vl:8b not installed"
}

Write-Host "Testing /api/generate..."
$gen = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -ContentType "application/json" -TimeoutSec 300 -Body (@{
  model = "qwen3-vl:8b"
  prompt = "Reply with exactly READY"
  stream = $false
  options = @{ num_predict = 64; temperature = 0 }
} | ConvertTo-Json -Depth 5)
$genKeys = @($gen.PSObject.Properties.Name) -join ","
$genLen = if ($null -ne $gen.response) { [string]$gen.response.Length } else { "null" }
$thinkLen = if ($gen.PSObject.Properties.Name -contains "thinking" -and $null -ne $gen.thinking) { [string]$gen.thinking.Length } else { "0" }
Write-Host "GENERATE_KEYS=$genKeys"
Write-Host "GENERATE_RESP_LEN=$genLen"
Write-Host "GENERATE_THINKING_LEN=$thinkLen"
Write-Host "GENERATE_DONE=$($gen.done)"

Write-Host "Testing /api/chat with format=json..."
$chat = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" -Method Post -ContentType "application/json" -TimeoutSec 300 -Body (@{
  model = "qwen3-vl:8b"
  stream = $false
  format = "json"
  messages = @(
    @{ role = "user"; content = 'Return JSON only: {"ok":true}' }
  )
  options = @{ num_predict = 128; temperature = 0 }
} | ConvertTo-Json -Depth 6)
$content = [string]$chat.message.content
Write-Host "CHAT_CONTENT_LEN=$($content.Length)"
if ($content.Length -gt 0) {
  $preview = $content.Substring(0, [Math]::Min(120, $content.Length))
  Write-Host "CHAT_PREVIEW=$preview"
} else {
  Write-Host "CHAT_PREVIEW=EMPTY"
  if ($chat.message.PSObject.Properties.Name -contains "thinking") {
    Write-Host "CHAT_HAS_THINKING=true thinking_len=$($chat.message.thinking.Length)"
  }
}
