param(
 [Parameter(Mandatory=$true)][string]$ReleaseDir,
 [Parameter(Mandatory=$true)][string]$ProjectId,
 [Parameter(Mandatory=$true)][string]$MachineRoot,
 [Parameter(Mandatory=$true)][string]$StateDir,
 [Parameter(Mandatory=$true)][string]$SecretFile,
 [Parameter(Mandatory=$true)][string]$MonitorConfig,
 [Parameter(Mandatory=$true)][string]$LogFile
)
$ErrorActionPreference='Stop'
if($ProjectId -notmatch '^[A-Za-z0-9_-]{1,64}$'){throw 'Invalid project'}
$release=[IO.Path]::GetFullPath($ReleaseDir).TrimEnd('\','/')
if((Get-Item -LiteralPath $release).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked release refused'}
$manifest=Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw|ConvertFrom-Json
foreach($entry in $manifest.files.PSObject.Properties){
 $file=[IO.Path]::GetFullPath((Join-Path $release $entry.Name))
 if(!$file.StartsWith($release+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid release path'}
 if((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked source refused'}
 if((Get-FileHash -LiteralPath $file).Hash -ne $entry.Value){throw 'Release hash mismatch'}
}
$node=(Get-Command node -ErrorAction Stop).Source
$previous=$LogFile+'.1'
# One bounded current log plus one rotated log; no collecting or VM command here.
& $node (Join-Path $release 'scripts/gen2-dashboard/run.mjs') --project $ProjectId --machine-root $MachineRoot --state-dir $StateDir --secret-file $SecretFile --batch-size 25 --monitor-config $MonitorConfig 2>&1 | ForEach-Object {
 if((Test-Path -LiteralPath $previous) -and (Get-Item -LiteralPath $previous).LastWriteTime -lt (Get-Date).AddDays(-7)){Remove-Item -LiteralPath $previous -Force}
 if((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -ge 10485760){Move-Item -LiteralPath $LogFile -Destination $previous -Force}
 Add-Content -LiteralPath $LogFile -Value $_ -Encoding UTF8
}
exit $LASTEXITCODE
