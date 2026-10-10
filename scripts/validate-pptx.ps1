<#
.SYNOPSIS
  Validate a .pptx by actually opening it in Microsoft PowerPoint (COM).

.DESCRIPTION
  The only honest way to prove a generated PowerPoint file is not corrupt is to
  let PowerPoint itself parse it. Reports slide count, page size, per-slide text,
  speaker notes and (optionally) rasterised slide images.

.EXAMPLE
  powershell -File scripts/validate-pptx.ps1 -Path test-results/out.pptx -AllText
  powershell -File scripts/validate-pptx.ps1 -Path out.pptx -OutFile result.json -ExportPng png/
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$AllText,
  [string]$ExportPng = '',
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'

function emit($text) {
  if ($OutFile) {
    # UTF-8 without BOM so Node can JSON.parse the file directly.
    [System.IO.File]::WriteAllText($OutFile, [string]$text, (New-Object System.Text.UTF8Encoding($false)))
  } else {
    Write-Output $text
  }
}

if (-not (Test-Path -LiteralPath $Path)) {
  emit (ConvertTo-Json @{ ok = $false; error = "file not found: $Path" } -Compress)
  exit 2
}
$full = (Resolve-Path -LiteralPath $Path).Path
$size = (Get-Item -LiteralPath $full).Length

$ppt = $null
$pres = $null
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  # Open(FileName, ReadOnly, Untitled, WithWindow) — WithWindow:$false keeps it headless.
  $pres = $ppt.Presentations.Open($full, $true, $false, $false)

  $slides = @()
  $count = $pres.Slides.Count
  for ($i = 1; $i -le $count; $i++) {
    $slide = $pres.Slides.Item($i)
    $texts = @()
    foreach ($shape in $slide.Shapes) {
      try {
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          $t = $shape.TextFrame.TextRange.Text
          if ($t) { $texts += (($t -replace "`r", ' ') -replace "`n", ' ').Trim() }
        }
      } catch { }
    }

    $notes = ''
    try {
      foreach ($shape in $slide.NotesPage.Shapes) {
        if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
          $candidate = $shape.TextFrame.TextRange.Text
          # the notes page also carries a slide-number placeholder: skip pure numbers
          if ($candidate -and $candidate.Trim() -notmatch '^\d+$') { $notes += $candidate }
        }
      }
    } catch { }

    $layoutName = ''
    try { $layoutName = [string]$slide.Layout.Name } catch { }

    $slideOut = @{
      index  = $i
      layout = $layoutName
      shapes = $slide.Shapes.Count
      texts  = $texts
    }
    if ($AllText) {
      $slideOut.notes = (($notes -replace "`r", ' ') -replace "`n", ' ').Trim()
    } else {
      $slideOut.notesLength = $notes.Length
    }
    $slides += $slideOut
  }

  $docTitle = ''
  try {
    $prop = $pres.BuiltInDocumentProperties.Item('Title')
    if ($prop) { $docTitle = [string]$prop.Value }
  } catch { $docTitle = '' }

  # Optional: rasterise every slide so the rendered result can be eyeballed.
  $pngFiles = @()
  if ($ExportPng) {
    try {
      $dir = [System.IO.Path]::GetFullPath($ExportPng)
      if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      $pres.Export($dir, 'PNG', 1280, 720)
      $pngFiles = Get-ChildItem -LiteralPath $dir | Sort-Object Name | ForEach-Object { $_.FullName }
    } catch {
      $pngFiles = @("EXPORT FAILED: " + $_.Exception.Message)
    }
  }

  $result = @{
    ok            = $true
    file          = $full
    bytes         = $size
    slides        = $count
    slideWidthPt  = [math]::Round($pres.PageSetup.SlideWidth, 2)
    slideHeightPt = [math]::Round($pres.PageSetup.SlideHeight, 2)
    title         = $docTitle
    png           = $pngFiles
    details       = $slides
  }
  emit (ConvertTo-Json $result -Depth 6 -Compress)
}
catch {
  emit (ConvertTo-Json @{ ok = $false; error = $_.Exception.Message; file = $full } -Compress)
  exit 1
}
finally {
  if ($pres) { try { $pres.Close() } catch { } }
  if ($ppt) { try { $ppt.Quit() } catch { } }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
