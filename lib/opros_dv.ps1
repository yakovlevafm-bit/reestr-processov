# Questionnaire xlsx post-processing via Excel COM: dropdown lists, wrap, row heights. Lists and files - lists.json (UTF-8, from lib/opros.js); this script is ASCII only.
param([string]$Json)
$ErrorActionPreference = 'Stop'
$J = Get-Content -Raw -Encoding UTF8 $Json | ConvertFrom-Json
$sep = [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ListSeparator
$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  foreach ($f in $J.files) {
    $wb = $xl.Workbooks.Open($f.file, 0, $false)
    try {
      $ws = $wb.Worksheets.Item(1); $a = $J.headRow + 1; $b = $J.headRow + $f.n; $lc = $J.lastCol
      foreach ($v in $J.validations) {
        $r = $ws.Range("$($v.col)$($a):$($v.col)$($b)"); $r.Validation.Delete()
        $r.Validation.Add(3, 1, 1, ($v.list -join $sep)); $r.Validation.IgnoreBlank = $true; $r.Validation.ShowError = $true; $r.Validation.ErrorMessage = 'Choose from list'
      }
      $ws.Range("A2:$($lc)2").Merge(); $ws.Range("A2:$($lc)2").WrapText = $true; $ws.Rows(2).RowHeight = 32
      foreach ($rr in 3, 4) { $ws.Range("A$($rr):C$($rr)").Merge(); $ws.Range("D$($rr):H$($rr)").Merge(); $ws.Range("A$($rr):C$($rr)").WrapText = $false; $ws.Range("A$($rr):C$($rr)").HorizontalAlignment = -4152; $ws.Rows($rr).RowHeight = 20 }
      $ws.Range("A$($J.headRow):$($lc)$b").WrapText = $true
      $ws.Range("A$($J.headRow):$($lc)$b").VerticalAlignment = -4160
      $ws.Rows($J.headRow).RowHeight = 48
      $ws.Range("A$($a):$($lc)$b").Rows.AutoFit() | Out-Null
      $ws.Activate(); $ws.Range("F$a").Select() | Out-Null
      $wb.Save(); "OK " + $f.n
    } finally { $wb.Close($false) }
  }
} finally { $xl.Quit() }
