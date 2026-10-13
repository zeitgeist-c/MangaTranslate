param([Parameter(Mandatory=$true)][string]$ProfileDirectory, [int]$Samples = 10)
$ErrorActionPreference = 'Stop'
$resolvedProfile = (Resolve-Path -LiteralPath $ProfileDirectory).Path
if ($resolvedProfile -notlike "$env:TEMP\mangalens-extension-*") { throw 'Only this task synthetic temporary browser profiles may be sampled.' }
$observations = @()
for ($sample = 0; $sample -lt $Samples; $sample++) {
  $all = @(Get-CimInstance Win32_Process -Filter "Name='brave.exe'")
  $roots = @($all | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($resolvedProfile, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -notmatch '--type=' })
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($rootProcess in $roots) { [void]$ids.Add([int]$rootProcess.ProcessId) }
  do {
    $beforeCount = $ids.Count
    foreach ($child in $all) { if ($ids.Contains([int]$child.ParentProcessId)) { [void]$ids.Add([int]$child.ProcessId) } }
  } while ($beforeCount -ne $ids.Count)
  $processes = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  if ($processes.Count) { $observations += [pscustomobject]@{utc=(Get-Date).ToUniversalTime().ToString('o');processes=$processes.Count;workingSetMiB=[math]::Round(($processes|Measure-Object WorkingSet64 -Sum).Sum/1MB,1)} }
  Start-Sleep -Milliseconds 1000
}
$report = [pscustomobject]@{measured=($observations.Count -gt 0);peakObservedWorkingSetMiB=($observations|Measure-Object workingSetMiB -Maximum).Maximum;observations=$observations;note='Sampled RSS sum of isolated browser tree, not allocation/VRAM nor guaranteed whole-run peak. Shared pages may be double counted.'}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot '../reports/browser-memory.json') -Encoding utf8
$report | ConvertTo-Json -Depth 4
