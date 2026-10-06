Add-Type -AssemblyName System.Drawing
$path = Join-Path (Get-Location) 'dist/print-trials/demo-purchase.png'
[System.IO.Directory]::CreateDirectory((Split-Path $path)) | Out-Null
$image = [System.Drawing.Bitmap]::new(1100, 700)
$graphics = [System.Drawing.Graphics]::FromImage($image)
$font = [System.Drawing.Font]::new('Arial', 22)
try {
    $graphics.Clear([System.Drawing.Color]::White)
    $text = "DEMO SUPPLIER - SYNTHETIC TEST ONLY`nPURCHASE BILL NO: DEMO-123`n`nITEM       STYLE      UNIT    QTY    UNIT COST    AMOUNT`nBALI       K5209      PAIR      4       25.50       102.00`n`nGST 18%: 18.36`nINVOICE TOTAL: 120.36`nNo selling price is specified."
    $graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, 25, 25)
    $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output 'Generated synthetic bill image; contains no customer data'
} finally { $font.Dispose(); $graphics.Dispose(); $image.Dispose() }
