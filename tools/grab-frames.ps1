# tools/grab-frames.ps1 -- GDI screen grabber that writes a JPEG frame sequence.
#
# Why this exists: when the plugin host cannot reach electron.desktopCapturer
# (e.g. the harness runs in an Electron utility process), the Incident Studio
# falls back to this pure-Windows path. The script grabs the (virtual) desktop at
# a fixed rate, scales it down, writes "<epochMs>.jpg" files, and exits as soon
# as the stop file appears.
#
# One long-lived process instead of one process per frame: a GDI grab costs
# 10-40 ms, but cold-starting PowerShell costs hundreds of milliseconds.
#
# Parameters:
#   -Out         output directory (created if missing)
#   -Fps         target frames per second (default 6)
#   -Width       output width, scaled proportionally (default 960)
#   -Quality     JPEG quality 30-95 (default 62)
#   -StopFile    exit when this file appears
#   -MaxSeconds  hard safety limit (default 600) so a forgotten stop cannot run forever
#
# NOTE: keep this file ASCII-only; Windows PowerShell 5.1 reads .ps1 as ANSI
# unless it has a BOM, so non-ASCII text here would break parsing.

param(
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Fps = 6,
    [int]$Width = 960,
    [int]$Quality = 62,
    [Parameter(Mandatory = $true)][string]$StopFile,
    [int]$MaxSeconds = 600
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not (Test-Path -LiteralPath $Out)) {
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
}

# Virtual desktop bounds (covers multi-monitor setups)
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$targetWidth = [Math]::Max(160, [Math]::Min(1920, $Width))
$scale = $targetWidth / [double]$bounds.Width
$targetHeight = [int][Math]::Round($bounds.Height * $scale)
if ($targetHeight -lt 90) { $targetHeight = 90 }
$intervalMs = [int][Math]::Floor(1000 / [Math]::Max(1, $Fps))

# JPEG encoder with an explicit quality parameter
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
if ($null -eq $encoder) { Write-Output 'error=no-jpeg-encoder'; exit 2 }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

$deadline = [DateTime]::UtcNow.AddSeconds($MaxSeconds)
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$written = 0
$failed = 0

while ($true) {
    if (Test-Path -LiteralPath $StopFile) { break }
    if ([DateTime]::UtcNow -gt $deadline) { break }

    $frameStart = $watch.ElapsedMilliseconds
    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    try {
        $full = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($full)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $full.Size)
        $graphics.Dispose()

        $thumb = New-Object System.Drawing.Bitmap $targetWidth, $targetHeight
        $thumbGraphics = [System.Drawing.Graphics]::FromImage($thumb)
        $thumbGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
        $thumbGraphics.DrawImage($full, 0, 0, $targetWidth, $targetHeight)
        $thumbGraphics.Dispose()

        $path = Join-Path -Path $Out -ChildPath ("{0}.jpg" -f $stamp)
        $thumb.Save($path, $encoder, $encoderParams)

        $thumb.Dispose()
        $full.Dispose()
        $written += 1
    }
    catch {
        # A grab can fail (locked screen, UAC desktop switch); retry next tick.
        $failed += 1
    }

    $spent = $watch.ElapsedMilliseconds - $frameStart
    $sleep = $intervalMs - $spent
    if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
}

Write-Output ("frames={0} failed={1} width={2} height={3}" -f $written, $failed, $targetWidth, $targetHeight)
