# ============================================================
#  AgentRouter model diagnostic
#  1. Put your NEW (regenerated) API key in $apiKey below
#  2. Save, then run in PowerShell:   .\test-agentrouter.ps1
#
#  Sends a tiny "hi" to each model with a 30s timeout, then
#  prints the response body + HTTP status code + time taken.
#  A hang shows up as a timeout instead of freezing forever.
# ============================================================

$apiKey  = "sk-Wj3cPvfzTtu6wqgrrNRpyFQ0D8fhwnAlrWzy5VStcoWnlyVk"
$baseUrl = "https://agentrouter.org/v1/chat/completions"
$stream  = $false   # set to $true to test streaming instead

$models = @(
    "claude-opus-5",
    "claude-opus-4-8",
    "gpt-5.6-sol",
    "glm-5.3",
    "deepseek-v4-flash"   # known-working control for comparison
)

foreach ($model in $models) {
    Write-Host "`n==================== $model ====================" -ForegroundColor Cyan

    $payload = @{
        model    = $model
        messages = @(@{ role = "user"; content = "hi" })
    }
    if ($stream) { $payload["stream"] = $true }

    $body = $payload | ConvertTo-Json -Depth 5 -Compress

    # Write JSON to a temp file (UTF-8, no BOM) to dodge PowerShell quoting issues
    $tmp = New-TemporaryFile
    [System.IO.File]::WriteAllText($tmp.FullName, $body)

    # -s -S : quiet but still show errors | --max-time 30 : give up after 30s
    # -w    : print HTTP status + total time after the body
    curl.exe -s -S --max-time 30 `
        -w "`n---- HTTP %{http_code} | time %{time_total}s ----`n" `
        -H "Authorization: Bearer $apiKey" `
        -H "Content-Type: application/json" `
        --data "@$($tmp.FullName)" `
        $baseUrl

    Remove-Item $tmp.FullName -ErrorAction SilentlyContinue
}

Write-Host "`nDone. For each block, read the response body + the HTTP code line." -ForegroundColor Green
