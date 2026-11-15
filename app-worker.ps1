$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName Accessibility
Add-Type -Path (Join-Path $PSScriptRoot 'app-accessibility.cs') -ReferencedAssemblies ([Accessibility.IAccessible].Assembly.Location)
[Console]::WriteLine('{"ready":true}')
while($null -ne ($line=[Console]::ReadLine())) {
    $request=$null
    try {
        $request=$line|ConvertFrom-Json
        [ScopedAppAccess]::ResetAction()
        switch($request.action) {
            'observe' {$result=@{ok=$true;observation=[ScopedAppAccess]::Observe([long]$request.window,[string]$request.appPath)}}
            'setText' {$value=[ScopedAppAccess]::SetText([string]$request.snapshotId,[string]$request.nodeId,[string]$request.appPath,[string]$request.text);$result=@{ok=($value -eq $request.text);accepted=$true;value=$value;beforeInputTick=[ScopedAppAccess]::BeforeInputTick;afterInputTick=[ScopedAppAccess]::AfterInputTick}}
            'invoke' {$result=@{ok=$true;accepted=[ScopedAppAccess]::Invoke([string]$request.snapshotId,[string]$request.nodeId,[string]$request.appPath)}}
            'enter' {$accepted=[ScopedAppAccess]::Enter([string]$request.snapshotId,[string]$request.nodeId,[string]$request.appPath);$result=@{ok=$true;accepted=$accepted;beforeInputTick=[ScopedAppAccess]::BeforeInputTick;afterInputTick=[ScopedAppAccess]::AfterInputTick}}
            'activateText' {$accepted=[ScopedAppAccess]::ActivateText([string]$request.snapshotId,[string]$request.nodeId,[string]$request.appPath,[string]$request.rowName);$result=@{ok=$true;accepted=$accepted;transport=[ScopedAppAccess]::ActionTransport;beforeInputTick=[ScopedAppAccess]::BeforeInputTick;afterInputTick=[ScopedAppAccess]::AfterInputTick}}
            default {throw 'unsupported_application_action'}
        }
        [Console]::WriteLine((@{id=$request.id;result=$result}|ConvertTo-Json -Depth 9 -Compress))
    } catch {[Console]::WriteLine((@{id=$request.id;result=@{ok=$false;accepted=[ScopedAppAccess]::ActionDispatched;error=$_.Exception.Message;beforeInputTick=[ScopedAppAccess]::BeforeInputTick;afterInputTick=[ScopedAppAccess]::AfterInputTick}}|ConvertTo-Json -Depth 4 -Compress))}
    finally {[ScopedAppAccess]::RestoreActionContext()}
}
