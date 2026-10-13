param([Parameter(Mandatory)][string]$Destination,
 [string]$ProfileRoot = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data\Profile 3",
 [string]$ExtensionId = 'dpeaamihpojkamjniglllgmelcanpcom')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (@(Get-Process brave -ErrorAction SilentlyContinue).Count) { throw 'Close Brave before capture.' }
if (Test-Path -LiteralPath $Destination) { throw 'Refusing to overwrite storage backup.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$records = [System.Collections.Generic.List[object]]::new()
$stream = [IO.MemoryStream]::new()
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
try {
 foreach ($relativeRoot in @("Local Extension Settings/$ExtensionId", "Sync Extension Settings/$ExtensionId", "IndexedDB/chrome-extension_${ExtensionId}_0.indexeddb.leveldb", "IndexedDB/chrome-extension_${ExtensionId}_0.indexeddb.blob")) {
  $area = Join-Path $ProfileRoot $relativeRoot
  if (!(Test-Path -LiteralPath $area)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $area -Recurse -Force -File) {
   $relative = [IO.Path]::GetRelativePath($ProfileRoot, $file.FullName).Replace('\','/')
   $bytes = [IO.File]::ReadAllBytes($file.FullName)
   $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
   $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal).Open()
   try { $entry.Write($bytes, 0, $bytes.Length) } finally { $entry.Dispose() }
   $records.Add([pscustomobject]@{path=$relative; bytes=$bytes.Length; sha256=$hash})
  }
 }
} finally { $zip.Dispose() }
if (!$records.Count) { throw 'No extension storage found.' }
if (@(Get-Process brave -ErrorAction SilentlyContinue).Count) { throw 'Brave reopened during capture; backup not saved.' }
foreach ($record in $records) {
 if ((Get-FileHash -LiteralPath (Join-Path $ProfileRoot $record.path)).Hash.ToLowerInvariant() -ne $record.sha256) { throw 'Source changed during capture.' }
}
$plain = $stream.ToArray(); $stream.Dispose()
try {
 $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllBytes($Destination,$encrypted)
 $restored = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Destination),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 try {
  if (![Security.Cryptography.CryptographicOperations]::FixedTimeEquals($plain,$restored)) { throw 'Decryption verification failed.' }
  $readStream = [IO.MemoryStream]::new($restored)
  $readZip = [IO.Compression.ZipArchive]::new($readStream,[IO.Compression.ZipArchiveMode]::Read)
  try {
   foreach ($record in $records) {
    $entryStream = $readZip.GetEntry($record.path).Open(); $buffer = [IO.MemoryStream]::new()
    try { $entryStream.CopyTo($buffer); $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($buffer.ToArray())).ToLowerInvariant() }
    finally { $buffer.Dispose(); $entryStream.Dispose() }
    if ($hash -ne $record.sha256) { throw 'Restored entry differs.' }
   }
  } finally { $readZip.Dispose(); $readStream.Dispose() }
 } finally { if ($restored) { [Array]::Clear($restored,0,$restored.Length) } }
} finally { [Array]::Clear($plain,0,$plain.Length) }
[ordered]@{createdAt=[DateTime]::UtcNow.ToString('o'); extensionId=$ExtensionId; profile=$ProfileRoot; encryption='DPAPI CurrentUser; same Windows account and machine'; files=$records; roundtripVerified=$true; browserRestoreTested=$false; sha256=(Get-FileHash -LiteralPath $Destination).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ($Destination+'.json') -Encoding utf8
Write-Output "Encrypted storage verified: $($records.Count) files. No plaintext key export."
