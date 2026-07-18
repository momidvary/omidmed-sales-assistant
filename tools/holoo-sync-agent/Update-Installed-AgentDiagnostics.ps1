[CmdletBinding()]
param(
    [string]$InstalledScript = (Join-Path $env:ProgramData "OmidMed\HolooSyncAgent\Invoke-HolooSync.ps1")
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InstalledScript)) {
    throw "Installed Holoo Agent script was not found: $InstalledScript"
}

$content = Get-Content -LiteralPath $InstalledScript -Raw -Encoding UTF8
$oldBlock = @'
            $response = $Client.SendAsync($request).GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) {
                throw ("API returned HTTP {0}." -f [int]$response.StatusCode)
            }

            $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
'@

$newBlock = @'
            $response = $Client.SendAsync($request).GetAwaiter().GetResult()
            $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) {
                $apiDetail = $responseText
                if (-not [string]::IsNullOrWhiteSpace($responseText)) {
                    try {
                        $errorResult = $responseText | ConvertFrom-Json
                        if ($errorResult.PSObject.Properties["error"] -and $errorResult.error) {
                            $apiDetail = [string]$errorResult.error
                        }
                    }
                    catch {
                        $apiDetail = $responseText
                    }
                }

                if ([string]::IsNullOrWhiteSpace($apiDetail)) {
                    throw ("API returned HTTP {0}." -f [int]$response.StatusCode)
                }

                throw ("API returned HTTP {0}: {1}" -f [int]$response.StatusCode, $apiDetail)
            }

'@

if ($content.Contains($newBlock.TrimEnd())) {
    Write-Host "Installed Agent diagnostics are already updated."
    exit 0
}

if (-not $content.Contains($oldBlock)) {
    throw "Expected HTTP handling block was not found. The installed script was not changed."
}

$backupPath = "$InstalledScript.bak-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item -LiteralPath $InstalledScript -Destination $backupPath -Force
$content = $content.Replace($oldBlock, $newBlock)
Set-Content -LiteralPath $InstalledScript -Value $content -Encoding UTF8

Write-Host "Installed Agent diagnostics updated successfully."
Write-Host "Backup: $backupPath"
