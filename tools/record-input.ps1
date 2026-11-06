# tools/record-input.ps1 -- lightweight keyboard/mouse recorder (polling, no hooks).
#
# Why polling: a low-level keyboard hook (WH_KEYBOARD_LL) is what keyloggers use,
# so it is both an antivirus magnet and a needless privilege escalation. Polling
# GetAsyncKeyState at ~30-60 Hz sees every human-scale press, needs no message
# loop, installs nothing and can be stopped by dropping a file.
#
# Privacy model (on purpose):
#   * only keyboard/mouse *state changes*, never text: no layout translation,
#     no ToUnicode, nothing that can rebuild what was typed;
#   * keys/clicks are only recorded while a configured target process owns the
#     foreground window (or -Scope all, minus -ExcludePid);
#   * process names are only written for configured targets; anything else is
#     reported as "other" (the plugin host itself as "self").
#
# Output: one JSON object per line, LF-terminated, ASCII-only (non-ASCII bytes
# in window/process names are \uXXXX-escaped). Kinds:
#   ready   {"t":..,"k":"ready","v":1,"mode":"poll","pollMs":20,"keys":108,
#            "scope":"target","targets":["remains"],"exclude":1234,"compileMs":459}
#   focus   {"t":..,"k":"focus","in":true,"pid":1234,"proc":"Remains"}
#   key     {"t":..,"k":"key","vk":65,"name":"A","d":1}      d=1 down, 0 up
#   btn     {"t":..,"k":"btn","vk":1,"name":"MouseLeft","d":1,"x":812,"y":640}
#   move    {"t":..,"k":"move","x":812,"y":640}              only with -TrailHz > 0
#   reset   {"t":..,"k":"reset","keys":["W","Space"]}        focus left the target
#   stop    {"t":..,"k":"stop","why":"stopfile","mergedMs":..,"keys":..,"clicks":..}
#   error   {"t":..,"k":"error","msg":".."}                  fatal, exit code 2
#
# Modes:
#   (default)  record until the stop file appears or -MaxSeconds elapses
#   -Probe     compile/load the interop assembly, write one ready line, exit
#   -SelfTest  push two synthetic ticks through the same diff/emit path, exit
#
# Parameters:
#   -Out <file>          JSONL output (or the one-line receipt in -Probe/-SelfTest)
#   -StopFile <file>     exit as soon as this file appears
#   -PollMs 20           sampling interval in milliseconds (20 ~ 30 Hz)
#   -MaxSeconds 1800     hard safety limit so a forgotten stop cannot run forever
#   -Scope target|all    record only while a target owns the foreground, or everything
#   -Targets "a,b"       comma separated process names (case insensitive, .exe optional)
#   -ExcludePid 1234     never record while this process owns the foreground (the host)
#   -ExcludeNames "a,b"  never record while one of these process names owns the foreground
#                        (the host app's main process may differ from the plugin host pid)
#   -TrailHz 0           >0 also records pointer positions at that rate
#   -CacheDir <dir>      where the compiled interop assembly is cached
#   -Probe               compile/load the interop assembly only, then exit
#   -SelfTest            push synthetic states through the diff/emit path, then exit
#
# The native surface lives in input-interop.cs next to this file. Add-Type
# compiles it to an explicit -OutputAssembly path (cached under
# %LOCALAPPDATA%\dsh-incident-studio) instead of `-MemberDefinition`, because
# that helper creates a random %TEMP% dll and replaces it -- which AV minifilters
# and host sandboxes can deny ("Access to the path ... is denied"), leaving the
# type unavailable.
#
# NOTE: keep this file ASCII-only; Windows PowerShell 5.1 reads .ps1 as ANSI
# unless it has a BOM, so non-ASCII text here would break parsing.

param(
    [string]$Out = '',
    [string]$StopFile = '',
    [int]$PollMs = 20,
    [int]$MaxSeconds = 1800,
    [string]$Scope = 'target',
    [string]$Targets = '',
    [int]$ExcludePid = 0,
    [string]$ExcludeNames = '',
    [int]$TrailHz = 0,
    [string]$CacheDir = '',
    [switch]$Probe,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Continue'
$script:TypeName = 'DshIncidentStudio.InputInterop'

# JSON string literal with everything outside printable ASCII escaped.
function ConvertTo-JsonText([string]$value) {
    if ($null -eq $value) { return '' }
    $builder = New-Object System.Text.StringBuilder
    foreach ($ch in $value.ToCharArray()) {
        $code = [int][char]$ch
        if ($ch -eq '"') { [void]$builder.Append('\"') }
        elseif ($ch -eq '\') { [void]$builder.Append('\\') }
        elseif ($code -lt 32 -or $code -gt 126) { [void]$builder.Append(('\u{0:x4}' -f $code)) }
        else { [void]$builder.Append($ch) }
    }
    return $builder.ToString()
}

function Write-Fatal([string]$message, [string]$path) {
    $stamp = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $line = '{"t":' + $stamp + ',"k":"error","msg":"' + (ConvertTo-JsonText $message) + '"}'
    if ($path -ne '') {
        try {
            $dir = Split-Path -Parent $path
            if ($dir -ne '' -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            [System.IO.File]::WriteAllText($path, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))
        } catch {
            # nothing else we can do
        }
    }
    Write-Output $line
}

if ($Out -eq '') {
    Write-Fatal '-Out is required' ''
    exit 1
}

# ---------------------------------------------------------------- interop ----
# Compile the C# source once, cache the assembly, reuse it on later runs.
$interopPath = Join-Path $PSScriptRoot 'input-interop.cs'
$script:CompileMs = -1
$script:AssemblyCached = $false

function Load-Interop() {
    if (-not (Test-Path -LiteralPath $interopPath)) { throw "cannot find $interopPath" }
    $source = [System.IO.File]::ReadAllText($interopPath, [System.Text.Encoding]::UTF8)
    $directories = New-Object System.Collections.Generic.List[string]
    if ($CacheDir -ne '') { $directories.Add($CacheDir) }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'dsh-incident-studio'),
        (Join-Path $env:TEMP 'dsh-incident-studio-cache'),
        (Split-Path -Parent $Out)
    )
    foreach ($candidate in $candidates) {
        if ($candidate -ne '' -and -not $directories.Contains($candidate)) { $directories.Add($candidate) }
    }
    $lastError = ''
    foreach ($directory in $directories) {
        $dll = Join-Path $directory 'input-interop-v1.dll'
        for ($attempt = 1; $attempt -le 2; $attempt++) {
            if ($attempt -eq 2) {
                # A stale/blocked cached dll: drop it and rebuild from source.
                try { Remove-Item -LiteralPath $dll -Force -ErrorAction SilentlyContinue } catch { }
            }
            try {
                if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
                $cached = Test-Path -LiteralPath $dll
                if (-not $cached) {
                    $watch = [System.Diagnostics.Stopwatch]::StartNew()
                    Add-Type -TypeDefinition $source -OutputAssembly $dll -Language CSharp -ErrorAction Stop
                    $script:CompileMs = $watch.ElapsedMilliseconds
                }
                $assembly = [System.Reflection.Assembly]::LoadFile($dll)
                $type = $assembly.GetType($script:TypeName)
                if ($null -eq $type) { throw 'interop type missing from assembly' }
                $null = $type.GetMethod('NowMs').Invoke($null, @())
                $script:AssemblyCached = $cached
                return
            } catch {
                $lastError = $_.Exception.Message
                if ($_.Exception.InnerException -ne $null) { $lastError = $lastError + ' / ' + $_.Exception.InnerException.Message }
            }
        }
    }
    throw ("interop unavailable: " + $lastError)
}

try {
    Load-Interop
} catch {
    Write-Fatal $_.Exception.Message $Out
    exit 2
}

$vkArray = [DshIncidentStudio.InputInterop]::VirtualKeys
$nameArray = [DshIncidentStudio.InputInterop]::KeyNames
$buttonStart = [DshIncidentStudio.InputInterop]::MouseButtonStart

# Cursor position: WinForms wraps GetCursorPos with correct POINT semantics and
# needs no compiled interop of its own.
try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
} catch {
    Write-Fatal ('Windows.Forms load failed: ' + $_.Exception.Message) $Out
    exit 2
}

# --------------------------------------------------------------- target set ----
$scopeMode = $Scope.ToLowerInvariant()
if ($scopeMode -ne 'all') { $scopeMode = 'target' }
$targetList = New-Object System.Collections.Generic.List[string]
foreach ($piece in ($Targets -split '[,;]+')) {
    $value = $piece.Trim().ToLowerInvariant()
    if ($value -eq '') { continue }
    if ($value.EndsWith('.exe')) { $value = $value.Substring(0, $value.Length - 4) }
    if ($value -ne '' -and -not $targetList.Contains($value)) { $targetList.Add($value) }
}
$targetArray = $targetList.ToArray()

# The hosting app's own process name(s): in Electron the window may belong to
# the app main process, not to the plugin host pid, so pid alone is not enough.
$excludeList = New-Object System.Collections.Generic.List[string]
foreach ($piece in ($ExcludeNames -split '[,;]+')) {
    $value = $piece.Trim().ToLowerInvariant()
    if ($value -eq '') { continue }
    if ($value.EndsWith('.exe')) { $value = $value.Substring(0, $value.Length - 4) }
    if ($value -ne '' -and -not $excludeList.Contains($value)) { $excludeList.Add($value) }
}

$procCache = @{}
function Get-ProcName([int]$processId) {
    if ($processId -le 0) { return '' }
    if ($script:procCache.ContainsKey($processId)) { return $script:procCache[$processId] }
    $name = ''
    try {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -ne $process) { $name = [string]$process.ProcessName }
    } catch {
        $name = ''
    }
    $script:procCache[$processId] = $name
    return $name
}

# ------------------------------------------------------------------ writer ----
$outDir = Split-Path -Parent $Out
if ($outDir -ne '' -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$writer = New-Object System.IO.StreamWriter($Out, $false, (New-Object System.Text.UTF8Encoding($false)))
$writer.AutoFlush = $false
$dirty = $false

function Write-Line([string]$line) {
    $script:writer.WriteLine($line)
    $script:dirty = $true
}

function Flush-Lines() {
    if ($script:dirty) {
        $script:writer.Flush()
        $script:dirty = $false
    }
}

function Send-Ready([string]$mode) {
    $stamp = [DshIncidentStudio.InputInterop]::NowMs()
    $targetJson = ''
    foreach ($item in $targetArray) {
        if ($targetJson -ne '') { $targetJson += ',' }
        $targetJson += '"' + (ConvertTo-JsonText $item) + '"'
    }
    $line = '{"t":' + $stamp + ',"k":"ready","v":1,"mode":"' + $mode + '","pollMs":' + $PollMs +
        ',"keys":' + $vkArray.Length + ',"scope":"' + $scopeMode + '","targets":[' + $targetJson +
        '],"exclude":' + $ExcludePid + ',"trailHz":' + $TrailHz + ',"compileMs":' + $script:CompileMs +
        ',"cached":' + [int]$script:AssemblyCached +
        ',"ps":"' + $PSVersionTable.PSVersion.ToString() + '"}'
    Write-Line $line
    Flush-Lines
}

# ------------------------------------------------------------ tick -> lines ----
# Shared state for the diffing engine (also used by -SelfTest).
$prev = [byte[]]::new($vkArray.Length)
$lastFgPid = -1
$lastInScope = $false
$lastMoveStamp = 0
# Field names avoid Hashtable members (keys/values/count): $hash.keys is a
# property, not our counter.
$counts = @{ keyDowns = 0; clickDowns = 0; moves = 0; resets = 0; focus = 0 }

# Emit one key/button transition. $isButton picks the field set.
function Emit-Transition([long]$stamp, [int]$index, [bool]$down, [int]$cursorX, [int]$cursorY) {
    $isButton = ($index -ge $buttonStart)
    $name = $nameArray[$index]
    $vk = $vkArray[$index]
    if ($isButton) {
        $payload = '{"t":' + $stamp + ',"k":"btn","vk":' + $vk + ',"name":"' + $name + '","d":' + [int]$down
        $payload += ',"x":' + $cursorX + ',"y":' + $cursorY + '}'
        if ($down) { $script:counts.clickDowns += 1 }
    } else {
        $payload = '{"t":' + $stamp + ',"k":"key","vk":' + $vk + ',"name":"' + $name + '","d":' + [int]$down + '}'
        if ($down) { $script:counts.keyDowns += 1 }
    }
    Write-Line $payload
}

# Compare the current byte state with the previous one and emit transitions.
# Outside the tracked window we keep $prev fresh but emit nothing.
function Apply-State([byte[]]$state, [bool]$inScope, [int]$cursorX, [int]$cursorY, [long]$stamp) {
    for ($index = 0; $index -lt $vkArray.Length; $index += 1) {
        $now = $state[$index]
        $was = $script:prev[$index]
        if ($now -eq $was) { continue }
        $script:prev[$index] = $now
        if (-not $inScope) { continue }
        Emit-Transition $stamp $index ($now -eq 1) $cursorX $cursorY
    }
}

# Clear every held key/button after focus loss; one reset line instead of a
# burst of fake key-up events (we cannot know when they were really released).
function Emit-Reset([long]$stamp) {
    $held = New-Object System.Collections.Generic.List[string]
    for ($index = 0; $index -lt $vkArray.Length; $index += 1) {
        if ($script:prev[$index] -eq 1) {
            $script:prev[$index] = 0
            $held.Add('"' + $nameArray[$index] + '"')
        }
    }
    if ($held.Count -eq 0) { return }
    $line = '{"t":' + $stamp + ',"k":"reset","keys":[' + ($held -join ',') + ']}'
    Write-Line $line
    $script:counts.resets += 1
}

# One polling tick (record mode): foreground, focus changes, keys, trail.
function Record-Tick([long]$stamp) {
    $fgPid = [DshIncidentStudio.InputInterop]::ForegroundPid()
    if ($fgPid -ne $script:lastFgPid) {
        $procName = Get-ProcName $fgPid
        $procLower = $procName.ToLowerInvariant()
        $inScope = $false
        $label = 'other'
        if ($ExcludePid -gt 0 -and $fgPid -eq $ExcludePid) {
            $label = 'self'
        } elseif ($excludeList.Contains($procLower)) {
            # The app that hosts us (its window can belong to another process).
            $label = 'self'
        } elseif ($scopeMode -eq 'all') {
            $inScope = $true
            $label = $procName
        } elseif ($targetArray.Contains($procLower)) {
            $inScope = $true
            $label = $procName
        }
        if ($script:lastFgPid -ne -1 -and $script:lastInScope -and -not $inScope) { Emit-Reset $stamp }
        # Only expose the pid when it is the target (or this host / an opted-in
        # "all" run); for anything else the record only says "other".
        $pidField = 0
        if ($inScope -or $label -eq 'self') { $pidField = $fgPid }
        $line = '{"t":' + $stamp + ',"k":"focus","in":' + [int]$inScope + ',"pid":' + $pidField +
            ',"proc":"' + (ConvertTo-JsonText $label) + '"}'
        Write-Line $line
        $script:counts.focus += 1
        $script:lastFgPid = $fgPid
        $script:lastInScope = $inScope
    }

    if ($script:lastInScope) {
        $state = [DshIncidentStudio.InputInterop]::ReadState()
        $point = [System.Windows.Forms.Cursor]::Position
        Apply-State $state $true $point.X $point.Y $stamp
        if ($TrailHz -gt 0 -and ($stamp - $script:lastMoveStamp) -ge [int][Math]::Floor(1000 / $TrailHz)) {
            $script:lastMoveStamp = $stamp
            Write-Line ('{"t":' + $stamp + ',"k":"move","x":' + $point.X + ',"y":' + $point.Y + '}')
            $script:counts.moves += 1
        }
    } else {
        # Keep $prev in sync so returning to the target does not replay old state.
        # The reset for held keys already happened in the focus-change branch.
        $state = [DshIncidentStudio.InputInterop]::ReadState()
        for ($index = 0; $index -lt $vkArray.Length; $index += 1) { $script:prev[$index] = $state[$index] }
    }
}

# -------------------------------------------------------------------- modes ----
try {
    if ($Probe) {
        Send-Ready 'probe'
        $writer.Dispose()
        exit 0
    }

    if ($SelfTest) {
        Send-Ready 'selftest'
        $stamp = [DshIncidentStudio.InputInterop]::NowMs()
        $synthetic = [byte[]]::new($vkArray.Length)
        # tick 1: A down + left button down at (100, 200)
        $synthetic[0] = 1
        $synthetic[$buttonStart] = 1
        Write-Line ('{"t":' + $stamp + ',"k":"focus","in":1,"pid":4242,"proc":"SelfTest"}')
        Apply-State $synthetic $true 100 200 $stamp
        # tick 2: A up, left button still down; then a focus-loss reset
        $stamp = $stamp + 40
        $synthetic[0] = 0
        Apply-State $synthetic $true 100 200 $stamp
        $stamp = $stamp + 40
        Emit-Reset $stamp
        Write-Line ('{"t":' + $stamp + ',"k":"stop","why":"selftest","mergedMs":80,"keys":' + $script:counts.keyDowns +
            ',"clicks":' + $script:counts.clickDowns + ',"moves":' + $script:counts.moves + ',"resets":' + $script:counts.resets + '}')
        Flush-Lines
        $writer.Dispose()
        exit 0
    }

    # Record mode.
    Send-Ready 'poll'
    $pollInterval = [Math]::Max(1, [Math]::Min(500, $PollMs))
    $deadlineMs = $MaxSeconds * 1000
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $stopWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $ticks = 0
    $why = 'stopfile'

    while ($true) {
        if ($stopWatch.ElapsedMilliseconds -ge 250) {
            $stopWatch.Restart()
            if ($StopFile -ne '' -and (Test-Path -LiteralPath $StopFile)) { $why = 'stopfile'; break }
            if ($watch.ElapsedMilliseconds -ge $deadlineMs) { $why = 'timeout'; break }
        }
        $tickStart = [DshIncidentStudio.InputInterop]::NowMs()
        Record-Tick $tickStart
        $ticks += 1
        Flush-Lines
        $spent = [DshIncidentStudio.InputInterop]::NowMs() - $tickStart
        $sleep = $pollInterval - $spent
        if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
    }

    $stamp = [DshIncidentStudio.InputInterop]::NowMs()
    if ($script:lastInScope) { Emit-Reset $stamp }
    Write-Line ('{"t":' + $stamp + ',"k":"stop","why":"' + $why + '","mergedMs":' + $watch.ElapsedMilliseconds +
        ',"ticks":' + $ticks +
        ',"keys":' + $script:counts.keyDowns + ',"clicks":' + $script:counts.clickDowns +
        ',"moves":' + $script:counts.moves + ',"resets":' + $script:counts.resets + ',"focus":' + $script:counts.focus + '}')
    Flush-Lines
    $writer.Dispose()
    Write-Output ('input=ok ticks={0} keys={1} clicks={2} moves={3} focus={4}' -f $ticks, $script:counts.keyDowns, $script:counts.clickDowns, $script:counts.moves, $script:counts.focus)
    exit 0
} catch {
    try { Flush-Lines } catch { }
    try { $writer.Dispose() } catch { }
    Write-Fatal ('recorder failed: ' + $_.Exception.Message) ''
    exit 2
}
