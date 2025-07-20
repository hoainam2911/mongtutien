chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# List of tools to monitor (match actual .js scripts running under node)
$tools = @(
    @{ Name = "Tool1"; Bat = "D:\WorkSpace\tools\mongtutie\vcl\mong\mong\run_mongtutien.bat"; Script = "mongtutien.js"; Log = "tool1_watchdog.log" },
    @{ Name = "Tool2"; Bat = "D:\WorkSpace\tools\mongtutie\vcl\mong\mong\boss.bat"; Script = "personalAndMine.js"; Log = "tool2_watchdog.log" },
    @{ Name = "Tool3"; Bat = "D:\WorkSpace\tools\mongtutie\vcl\mong\mong\wboss.bat"; Script = "worldBoss.js"; Log = "tool3_watchdog.log" }
)

Write-Host "========================================="
Write-Host "       NODE.JS TOOL MONITOR (MULTI)"
Write-Host "========================================="

function LogMessage($file, $message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$timestamp $message"
    Add-Content -Path $file -Value $line
    Write-Host $line
}

while ($true) {
    foreach ($tool in $tools) {
        $running = Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq "node.exe" -and $_.CommandLine -like "*$($tool.Script)*"
        }

        if (-not $running) {
            LogMessage $tool.Log "[X] [$($tool.Name)] is not running. Restarting..."
            Start-Process -FilePath $tool.Bat
        } else {
            LogMessage $tool.Log "[OK] [$($tool.Name)] is running."
        }
    }

    Start-Sleep -Seconds 30
}
