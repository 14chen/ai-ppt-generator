$ErrorActionPreference = 'Continue'
$full = (Resolve-Path -LiteralPath 'test-results/probe.pptx').Path
Write-Output "file: $full"

Write-Output '--- step 1: create COM object ---'
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  Write-Output ("  created: " + ($null -ne $ppt) + "  version=" + $ppt.Version)
} catch { Write-Output ("  FAIL: " + $_.Exception.Message); exit 1 }

Write-Output '--- step 2: Presentations collection ---'
try {
  $presentations = $ppt.Presentations
  Write-Output ("  Presentations is null: " + ($null -eq $presentations))
  Write-Output ("  count = " + $presentations.Count)
} catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

Write-Output '--- step 3: Open (ReadOnly, no window) ---'
try {
  $pres = $ppt.Presentations.Open($full, $true, $false, $false)
  Write-Output ("  opened, is null: " + ($null -eq $pres))
} catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

if ($pres) {
  Write-Output '--- step 4: Slides.Count ---'
  try { Write-Output ("  slides = " + $pres.Slides.Count) } catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

  Write-Output '--- step 5: PageSetup ---'
  try {
    $ps = $pres.PageSetup
    Write-Output ("  pageSetup null: " + ($null -eq $ps))
    if ($ps) { Write-Output ("  width=" + $ps.SlideWidth + " height=" + $ps.SlideHeight) }
  } catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

  Write-Output '--- step 6: slide 1 layout + shapes ---'
  try {
    $s = $pres.Slides.Item(1)
    Write-Output ("  slide null: " + ($null -eq $s))
    $lay = $s.Layout
    Write-Output ("  layout null: " + ($null -eq $lay))
    if ($lay) { Write-Output ("  layout name = " + $lay.Name) }
    Write-Output ("  shapes = " + $s.Shapes.Count)
    foreach ($sh in $s.Shapes) {
      Write-Output ("    shape type=" + $sh.Type + " hasTextFrame=" + $sh.HasTextFrame)
    }
  } catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

  Write-Output '--- step 7: NotesPage ---'
  try {
    $np = $s.NotesPage
    Write-Output ("  notesPage null: " + ($null -eq $np))
    if ($np) { Write-Output ("  notes shapes = " + $np.Shapes.Count) }
  } catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

  Write-Output '--- step 8: BuiltInDocumentProperties ---'
  try {
    $bip = $pres.BuiltInDocumentProperties
    Write-Output ("  bip null: " + ($null -eq $bip))
    $t = $bip.Item('Title')
    Write-Output ("  title prop null: " + ($null -eq $t))
    if ($t) { Write-Output ("  title value = [" + $t.Value + "]") }
  } catch { Write-Output ("  FAIL: " + $_.Exception.Message) }

  try { $pres.Close() } catch { Write-Output ("close FAIL: " + $_.Exception.Message) }
}
try { $ppt.Quit() } catch { Write-Output ("quit FAIL: " + $_.Exception.Message) }
Write-Output 'done'
