[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$BaseUrl = 'http://127.0.0.1:23456'

function Test-CatraceConnection {
    $body = @{event = 'Ping'; state = 'idle'; session_id = 'ping-check'; cwd = 'D:/workspace/Catrace'; prompt = ''; transcript_path = ''} | ConvertTo-Json -Compress
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
        Invoke-RestMethod -Uri "$BaseUrl/state" -Method POST -ContentType 'application/json' -Body $json -TimeoutSec 3 | Out-Null
        Write-Host '[OK] /state accepted (HTTP 200)' -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    }
}

# P6: permission approval uses the BLOCKING /permission endpoint, not /state.
# This call hangs until you click Allow/Deny in the approval card (or ~9 min timeout).
function Send-Permission {
    param([string]$Title, [hashtable]$Body)
    Write-Host ''
    Write-Host '============================================' -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host '============================================' -ForegroundColor Cyan
    Write-Host 'This call BLOCKS until you click Allow/Deny in the approval card...' -ForegroundColor Yellow

    $json = $Body | ConvertTo-Json -Compress
    try {
        $response = Invoke-RestMethod -Uri "$BaseUrl/permission" -Method POST -ContentType 'application/json' -Body $json -TimeoutSec 600
        $decision = $response.hookSpecificOutput.decision.behavior
        if ($decision) {
            Write-Host "[OK] Decision returned: $decision" -ForegroundColor Green
        } else {
            Write-Host '[OK] Empty response (timeout / go-to-terminal) -> Claude falls back to terminal' -ForegroundColor Yellow
        }
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
Write-Host 'Catrace Agent Hook Test (P6)' -ForegroundColor Cyan
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
    cwd = 'D:/workspace/Catrace'
    prompt = ''
    transcript_path = ''
}

Wait-Continue

# P6 fix: the approval card is triggered by /permission (blocking), not by /state PermissionRequest.
Send-Permission -Title '[2/4] Permission - expect APPROVAL card (amber) -> click Allow/Deny' -Body @{
    event = 'PermissionRequest'
    state = 'permission'
    session_id = 'test-sess-1'
    cwd = 'D:/workspace/Catrace'
    tool_name = 'Bash'
    tool_input = @{ command = 'git status'; description = 'Show working tree status' }
    prompt = ''
    transcript_path = ''
}

Wait-Continue

Send-Event -Title '[3/4] UserPromptSubmit - should NOT pop new card, should dismiss test-sess-1' -Body @{
    event = 'UserPromptSubmit'
    state = 'thinking'
    session_id = 'test-sess-1'
    cwd = 'D:/workspace/Catrace'
    prompt = 'continue'
    transcript_path = ''
}

Wait-Continue

Send-Event -Title '[4/4] StopFailure - expect sticky card: task failed / waiting for you' -Body @{
    event = 'StopFailure'
    state = 'attention'
    session_id = 'test-sess-2'
    cwd = 'D:/workspace/Catrace'
    prompt = ''
    transcript_path = ''
}

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host 'Test complete' -ForegroundColor Cyan
Write-Host '============================================' -ForegroundColor Cyan
