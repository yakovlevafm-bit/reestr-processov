# Простая анкета: выпадающие списки, перенос текста, высота строк (Excel COM). Списки и файлы — export/анкеты2/lists.json (UTF-8); скрипт только ASCII.
param([string]$Json)
$ErrorActionPreference = 'Stop'
$J = Get-Content -Raw -Encoding UTF8 $Json | ConvertFrom-Json
$sep = [System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ListSeparator
$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  foreach ($f in $J.files) {
    $wb = $xl.Workbooks.Open($f.file, 0, $false)
    try {
      $ws = $wb.Worksheets.Item(1); $a = $J.headRow + 1; $b = $J.headRow + $f.n
      $set = { param($col, $list) $r = $ws.Range("$col$($a):$col$($b)"); $r.Validation.Delete(); $r.Validation.Add(3, 1, 1, ($list -join $sep)); $r.Validation.IgnoreBlank = $true; $r.Validation.ShowError = $true; $r.Validation.ErrorMessage = 'Choose from list' }
      & $set 'G' $J.lists.status; & $set 'J' $J.lists.docs; & $set 'K' $J.lists.problems; & $set 'L' $J.lists.risk
      $ws.Range('A2:M2').Merge(); $ws.Range('A2:M2').WrapText = $true; $ws.Rows(2).RowHeight = 32
      foreach ($rr in 3, 4) { $ws.Range("A$($rr):C$($rr)").Merge(); $ws.Range("D$($rr):I$($rr)").Merge(); $ws.Range("A$($rr):C$($rr)").WrapText = $false; $ws.Range("A$($rr):C$($rr)").HorizontalAlignment = -4152; $ws.Rows($rr).RowHeight = 20 }
      $ws.Range("A$($J.headRow):M$b").WrapText = $true
      $ws.Range("A$($J.headRow):M$b").VerticalAlignment = -4160
      $ws.Range("H$($a):I$($b)").NumberFormat = '@'  # текст: «5-10» и «12.10» не превращаются в даты
      $ws.Rows($J.headRow).RowHeight = 48
      $ws.Range("A$($a):M$b").Rows.AutoFit() | Out-Null
      $ws.Activate(); $ws.Range("G$a").Select() | Out-Null
      $wb.Save(); "OK " + $f.n
    } finally { $wb.Close($false) }
  }
} finally { $xl.Quit() }
