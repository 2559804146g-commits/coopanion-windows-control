param([string]$PlayerPath = 'G:\网易云\CloudMusic\cloudmusic.exe')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$script:manager = $null
$script:startupError = $null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName Accessibility
Add-Type -Path (Join-Path $PSScriptRoot 'music-accessibility.cs') -ReferencedAssemblies ([Accessibility.IAccessible].Assembly.Location)
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $script:propertyType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-Media($operation, [Type]$resultType) {
        $method = $script:asTask.MakeGenericMethod([Type[]]@($resultType))
        $task = $method.Invoke($null, @($operation))
        if (-not $task.Wait(10000)) { throw 'Windows media operation timed out' }
        return $task.Result
    }
    $script:manager = Await-Media ($script:managerType::RequestAsync()) $script:managerType
} catch { $script:startupError = $_.Exception.Message }

function Get-NeteaseSession {
    if ($null -eq $script:manager) { return $null }
    $current = $script:manager.GetCurrentSession()
    if ($null -ne $current -and $current.SourceAppUserModelId -match '(?i)cloudmusic|netease.*music') { return $current }
    foreach ($session in $script:manager.GetSessions()) {
        if ($session.SourceAppUserModelId -match '(?i)cloudmusic|netease.*music') { return $session }
    }
    return $null
}
function Get-NeteaseWindows {
    foreach ($process in [Diagnostics.Process]::GetProcessesByName('cloudmusic')) {
        try {
            if ($process.MainModule.FileName -ne $PlayerPath) {continue}
            foreach($handle in [NeteasePlaybackAccess]::WindowsForProcess($process.Id)) {
                [PSCustomObject]@{Handle=[IntPtr]$handle;Title=[NeteasePlaybackAccess]::Caption($handle)}
            }
        } catch { }
    }
}
function Get-NeteaseUia {
    $script:uiaDiagnostic=$null
    $script:uiaWindows=0
    foreach ($window in Get-NeteaseWindows) {
        try {
            $script:uiaWindows++
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
            $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'btn_pc_minibar_play')
            $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
            if ($null -eq $button) {
                $buttons=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button))
                $bottom=$root.Current.BoundingRectangle.Bottom
                foreach($item in $buttons) {
                    if($item.Current.Name -in @('play','pause') -and -not $item.Current.IsOffscreen -and $item.Current.BoundingRectangle.Bottom -gt ($bottom-110)) {$button=$item;break}
                }
                if($null -eq $button){$script:uiaDiagnostic='play_control_not_found;button_count='+$buttons.Count}
            }
            if ($null -ne $button) { return @{root=$root; button=$button; title=$root.Current.Name; hwnd=$window.Handle.ToInt64()} }
        } catch { $script:uiaDiagnostic=$_.Exception.Message }
    }
    return $null
}
function Get-UiaState {
    $ui = Get-NeteaseUia
    if ($null -eq $ui) {
        foreach ($window in Get-NeteaseWindows) {
            try {
                $access=[NeteasePlaybackAccess]::Observe($window.Handle.ToInt64())
                if($access.Found) {
                    $caption=$window.Title; $title=$caption; $artist='';$separator=$caption.LastIndexOf(' - ')
                    if($separator -gt 0){$artist=$caption.Substring($separator+3);$title=$caption.Substring(0,$separator)}
                    return @{available=$true;player='netease';transport='msaa';sourceId='cloudmusic.exe';status=$(if($access.Button -eq 'pause'){'Playing'}else{'Paused'});title=$title;artist=$artist;buttonName=$access.Button;hwnd=$window.Handle.ToInt64();canPlay=$true;canPause=$true;canNext=$access.CanNext;canPrevious=$access.CanPrevious;observedAt=[DateTimeOffset]::Now.ToString('o');apiReady=$true}
                }
                $script:uiaDiagnostic='msaa_nodes='+$access.Nodes+';'+$access.Error
            } catch { $script:uiaDiagnostic=$_.Exception.Message }
        }
        return @{available=$false; player='netease'; reason='no_netease_controls'; apiReady=($null -ne $script:manager); error=$script:startupError; diagnostic=$script:uiaDiagnostic; windowCandidates=$script:uiaWindows}
    }
    $buttonName = $ui.button.Current.Name
    $status = 'Unknown'
    if ($buttonName -eq 'pause') { $status='Playing' }
    elseif ($buttonName -eq 'play') { $status='Paused' }
    $title = $ui.title; $artist=''
    $separator = $title.LastIndexOf(' - ')
    if ($separator -gt 0) { $artist=$title.Substring($separator+3); $title=$title.Substring(0,$separator) }
    return @{available=$true; player='netease'; sourceId='cloudmusic.exe'; transport='uia'; status=$status; title=$title; artist=$artist; buttonName=$buttonName; hwnd=$ui.hwnd; canPlay=$true; canPause=$true; canNext=$true; canPrevious=$true; observedAt=[DateTimeOffset]::Now.ToString('o'); apiReady=$true}
}
function Invoke-UiaControl([string]$action) {
    $ui=Get-NeteaseUia
    if ($null -eq $ui) {
        foreach($window in Get-NeteaseWindows) {
            try {
                if([NeteasePlaybackAccess]::Invoke($window.Handle.ToInt64(),$action)){return $true}
            } catch { }
        }
        return $false
    }
    $control=$ui.button
    if ($action -in @('next','previous')) {
        $parent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($control)
        $name=if($action -eq 'next'){'next'}else{'pre'}
        $condition=[System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name),
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button))
        $control=$parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
    } else {
        $current=$control.Current.Name
        if (($action -eq 'play' -and $current -eq 'pause') -or ($action -eq 'pause' -and $current -eq 'play')) { return $true }
        if ($current -notin @('play','pause')) { return $false }
    }
    if ($null -eq $control -or -not $control.Current.IsEnabled) { return $false }
    $invoke=$null
    if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)) { $invoke.Invoke(); return $true }
    $legacy=$null
    if ($control.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$legacy)) { $legacy.DoDefaultAction(); return $true }
    return $false
}
function Get-MediaState($session) {
    if ($null -eq $session) { return Get-UiaState }
    $playback = $session.GetPlaybackInfo()
    $properties = Await-Media ($session.TryGetMediaPropertiesAsync()) $script:propertyType
    $timeline = $session.GetTimelineProperties()
    return @{
        available=$true; player='netease'; sourceId=$session.SourceAppUserModelId; transport='smtc'
        status=$playback.PlaybackStatus.ToString(); title=$properties.Title; artist=$properties.Artist
        album=$properties.AlbumTitle; positionSeconds=$timeline.Position.TotalSeconds
        canPlay=$playback.Controls.IsPlayEnabled; canPause=$playback.Controls.IsPauseEnabled
        canNext=$playback.Controls.IsNextEnabled; canPrevious=$playback.Controls.IsPreviousEnabled
        observedAt=[DateTimeOffset]::Now.ToString('o'); apiReady=$true
    }
}
[Console]::WriteLine((@{ready=($null -ne $script:manager); error=$script:startupError} | ConvertTo-Json -Compress))
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    $restoredWindow = 0L
    try {
        $request = $line | ConvertFrom-Json
        if ($request.action -in @('play','pause','next','previous')) {
            foreach ($window in Get-NeteaseWindows) {
                if ([NeteasePlaybackAccess]::RestoreForControl($window.Handle.ToInt64())) { $restoredWindow=$window.Handle.ToInt64(); Start-Sleep -Milliseconds 300; break }
            }
        }
        $session = Get-NeteaseSession
        $before = Get-MediaState $session
        if ($request.action -eq 'status') { $result = @{ok=$true; state=$before} }
        elseif ($request.action -in @('play','pause','next','previous')) {
            if (-not $before.available) { $result = @{ok=$false; reason='no_netease_controls'; state=$before} }
            else {
                if ($null -eq $session) { $accepted=Invoke-UiaControl $request.action }
                else { switch ($request.action) {
                    'play' { $accepted = Await-Media ($session.TryPlayAsync()) ([bool]) }
                    'pause' { $accepted = Await-Media ($session.TryPauseAsync()) ([bool]) }
                    'next' { $accepted = Await-Media ($session.TrySkipNextAsync()) ([bool]) }
                    'previous' { $accepted = Await-Media ($session.TrySkipPreviousAsync()) ([bool]) }
                }
                }
                Start-Sleep -Milliseconds 350
                $after = Get-MediaState $session
                $confirmed = $false
                if ($request.action -eq 'play') {
                    for ($i=0; $i -lt 12; $i++) { $confirmed=$after.status -eq 'Playing'; if($confirmed){break}; Start-Sleep -Milliseconds 400; $after=Get-MediaState $session }
                }
                elseif ($request.action -eq 'pause') {
                    for ($i=0; $i -lt 12; $i++) { $confirmed=$after.status -in @('Paused','Stopped'); if($confirmed){break}; Start-Sleep -Milliseconds 400; $after=Get-MediaState $session }
                }
                else {
                    for ($i=0; $i -lt 5; $i++) {
                        $confirmed = ($after.title -ne $before.title -or $after.artist -ne $before.artist -or ($before.positionSeconds -gt 3 -and $after.positionSeconds -lt 2))
                        if ($confirmed) { break }; Start-Sleep -Milliseconds 350; $after=Get-MediaState $session
                    }
                }
                $result = @{ok=([bool]$accepted -and $confirmed); accepted=[bool]$accepted; verified=$confirmed; before=$before; state=$after}
            }
        } else { throw 'Unsupported media command' }
        [Console]::WriteLine((@{id=$request.id; result=$result} | ConvertTo-Json -Depth 7 -Compress))
    } catch { [Console]::WriteLine((@{id=$request.id; result=@{ok=$false; error=$_.Exception.Message}} | ConvertTo-Json -Depth 4 -Compress)) }
    finally { if ($restoredWindow -ne 0) { [NeteasePlaybackAccess]::FinishControl($restoredWindow) } }
}
