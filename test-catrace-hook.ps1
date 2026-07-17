[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$BaseUrl = 'http://127.0.0.1:23456'

function Test-CatraceConnection {
    $body = @{event = 'Ping'; state = 'idle'; session_id = 'ping-check'; cwd = 'C:/work_sapce/Catrace'; prompt = ''; transcript_path = ''} | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri "$BaseUrl/state" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 3 | Out-Null
        Write-Host '[OK] Catrace HTTP service is running' -ForegroundColor Green
        return $true
    } catch {
        Write-Host "[FAIL] Cannot reach $BaseUrl. Make sure Catrace is running and agent notifications are enabled." -ForegroundColor Red
        Write-Host "       Error: $($_.Exception.Message)" -ForegroundColor DarkGray
        return $false
    }
}

function Send-Event {
    param([string]$Title, [hashtable]$Body)
    Write-Host ''
    Write-Host '============================================' -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host '============================================' -ForegroundColor Cyan

    $json = $Body | ConvertTo-Json -Compress
    try {
        $response = Invoke-RestMethod -Uri "$BaseUrl/state" -Method POST -ContentType 'application/json' -Body $json -TimeoutSec 3
        Write-Host "[OK] Response: $response" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Wait-Continue {
    Write-Host ''
    Write-Host 'Press any key to continue...' -ForegroundColor DarkGray
    $null = [System.Console]::ReadKey($true)
}

Write-Host '============================================' -ForegroundColor Cyan
Write-Host 'Catrace Agent Hook Test' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan

if (-not (Test-CatraceConnection)) {
    Write-Host ''
    Write-Host 'Press any key to exit...' -ForegroundColor Red
    $null = [System.Console]::ReadKey($true)
    exit 1
}

Send-Event -Title '[1/4] Stop - expect sticky card: task done / waiting for you' -Body @{
    event = 'Stop'
    state = 'attention'
    session_id = 'test-sess-1'
    cwd = 'C:/work_sapce/Catrace'
    prompt = ''
    transcript_path = ''
}

Wait-Continue

Send-Event -Title '[2/4] PermissionRequest - expect sticky card: waiting for approval: Bash' -Body @{
    event = 'PermissionRequest'
    state = 'permission'
    session_id = 'test-sess-1'
    cwd = 'C:/work_sapce/Catrace'
    tool_name = 'Bash'
    prompt = ''
    transcript_path = ''
}

Wait-Continue

Send-Event -Title '[3/4] UserPromptSubmit - should NOT pop new card, should dismiss test-sess-1' -Body @{
    event = 'UserPromptSubmit'
    state = 'thinking'
    session_id = 'test-sess-1'
    cwd = 'C:/work_sapce/Catrace'
    prompt = 'continue'
    transcript_path = ''
}

Wait-Continue

Send-Event -Title '[4/4] StopFailure - expect sticky card: task failed / waiting for you' -Body @{
    event = 'StopFailure'
    state = 'attention'
    session_id = 'test-sess-2'
    cwd = 'C:/work_sapce/Catrace'
    prompt = ''
    transcript_path = ''
}

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host 'Test complete' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
