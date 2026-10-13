param([string]$Repo = 'T22016AEMC/PitchVision-v4')
$ErrorActionPreference = 'Stop'
# Use the existing OS credential helper in memory; never print or persist credentials.
$credentialLines = "protocol=https`nhost=github.com`n`n" | git credential fill
$credentialMap = @{}
foreach ($line in $credentialLines) { if ($line.Contains('=')) { $parts=$line.Split('=',2); $credentialMap[$parts[0]]=$parts[1] } }
if (!$credentialMap['password']) { throw 'GitHub credential unavailable' }
$headers = @{ Authorization="Bearer $($credentialMap['password'])"; Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28' }
$runs=Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/runs?per_page=5" -Headers $headers
$runs.workflow_runs | Select-Object id,name,status,conclusion,head_sha,html_url | ConvertTo-Json -Depth 4
$credentialMap.Clear()
