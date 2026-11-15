param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Work)
$ErrorActionPreference='Stop'
$setupPath=(Resolve-Path -LiteralPath $Installer).Path
$testHome=[IO.Path]::GetFullPath($Work)
$programDir=Join-Path $testHome 'app'
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CompanionControl'
$retentionProfilePath=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CompanionControl\Profile'
$desktopLink=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) '桌面伙伴.lnk'
$menuDir=Join-Path ([Environment]::GetFolderPath('Programs')) '桌面伙伴'
# Hosted Windows service accounts have not necessarily performed a first desktop logon.
$desktopDir=Split-Path -Parent $desktopLink
if(-not (Test-Path -LiteralPath $desktopDir)){New-Item -ItemType Directory -Path $desktopDir -Force | Out-Null}
# This verifier is intentionally restricted to a fresh Windows user / build machine.
foreach($existing in @($key,$retentionProfilePath,$desktopLink,$menuDir,$testHome)){
 if(Test-Path -LiteralPath $existing){throw 'Installation verification requires a clean user profile and a new work directory.'}
}
New-Item -ItemType Directory -Path $testHome | Out-Null
New-Item -ItemType Directory -Path $retentionProfilePath -Force | Out-Null
$sentinel=Join-Path $retentionProfilePath 'installer-retention-test.txt'
[IO.File]::WriteAllText($sentinel,'preserve-test-data')
$installed=Start-Process -FilePath $setupPath -ArgumentList @('/S',('/D='+$programDir)) -WindowStyle Hidden -Wait -PassThru
if($installed.ExitCode -ne 0){throw ('Installer exit code '+$installed.ExitCode)}
if(-not (Test-Path -LiteralPath (Join-Path $programDir 'CompanionControl.exe'))){throw 'Launcher was not installed'}
if(-not (Test-Path -LiteralPath $key)){throw 'Installed Apps entry missing'}
$shell=New-Object -ComObject WScript.Shell
if(-not (Test-Path -LiteralPath $desktopLink)){
 Write-Host ('Expected desktop: '+$desktopDir)
 Get-ChildItem -LiteralPath $desktopDir -Force | Select-Object Name,FullName | Format-List | Out-String | Write-Host
 $programsRoot=[Environment]::GetFolderPath('Programs')
 Get-ChildItem -LiteralPath $programsRoot -Force | Select-Object Name | Format-Table | Out-String | Write-Host
 throw 'Installer did not create the expected desktop shortcut'
}
$shortcut=$shell.CreateShortcut($desktopLink)
$target=$shortcut.TargetPath
Write-Host ('Shortcut metadata: '+(@{bytes=(Get-Item -LiteralPath $desktopLink).Length;target=$target;fullName=$shortcut.FullName} | ConvertTo-Json -Compress))
# Launch the actual .lnk through Windows Shell: this is the user-visible contract.
python "$PSScriptRoot/verify-startup.py" $programDir $retentionProfilePath --shortcut $desktopLink --default-profile
if($LASTEXITCODE -ne 0){throw 'Installed desktop shortcut or profile persistence failed'}
$env:COMPANION_INSTALL_VERIFY_ROOT=$programDir
$verifyCode=@'
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=process.env.COMPANION_INSTALL_VERIFY_ROOT,m=JSON.parse(fs.readFileSync(path.join(root,'Control/bundle-manifest.json')));let count=0;
for(const [name,v]of Object.entries(m.files)){const b=fs.readFileSync(path.join(root,name));if(crypto.createHash('sha256').update(b).digest('hex')!==v.sha256)throw Error('Installed file differs: '+name);count++;}
console.log(JSON.stringify({version:m.version,files:count,hashes:true,node:process.version}));
'@
$hashResult=& (Join-Path $programDir 'Runtime\node.exe') --input-type=module -e $verifyCode
if($LASTEXITCODE -ne 0){throw 'Installed file verification failed'}
$hashReport=$hashResult | ConvertFrom-Json
$extra=Join-Path $programDir 'user-added-file.txt'
[IO.File]::WriteAllText($extra,'preserve-unknown-file')
$uninstalled=Start-Process -FilePath (Join-Path $programDir 'Uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if($uninstalled.ExitCode -ne 0){throw ('Uninstaller exit code '+$uninstalled.ExitCode)}
$deadline=(Get-Date).AddSeconds(30)
while((Test-Path -LiteralPath $key) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 250}
if(Test-Path -LiteralPath $key){throw 'Installed Apps entry was not removed'}
if(Test-Path -LiteralPath $desktopLink){throw 'Desktop shortcut was not removed'}
if([IO.File]::ReadAllText($sentinel) -ne 'preserve-test-data'){throw 'User profile was not preserved'}
if([IO.File]::ReadAllText($extra) -ne 'preserve-unknown-file'){throw 'An unknown user file was removed'}
$report=[ordered]@{version=$hashReport.version;installedFiles=$hashReport.files;installedHashesMatch=$hashReport.hashes;bundledNode=$hashReport.node;desktopShortcut=$true;installedAppsEntry=$true;uninstall=$true;profilePreserved=$true;unknownFilePreserved=$true}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testHome 'installation-verification.json') -Encoding utf8
# Remove only files created by this test, never recursively delete a directory.
Remove-Item -LiteralPath $extra
if(@(Get-ChildItem -LiteralPath $programDir -Force).Count -ne 0){throw 'Unexpected files remain after uninstall; refusing recursive cleanup'}
Remove-Item -LiteralPath $programDir
Remove-Item -LiteralPath $sentinel
# Keep generated chats/settings in the disposable CI profile, exactly as uninstall promises.
$report | ConvertTo-Json
