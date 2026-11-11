# Liga o robo da revenda escondido e religa sozinho se ele cair.
# Abre junto com o Windows (atalho na pasta Inicializar).
# 10/11/2026: com varios numeros de WhatsApp, cada robo confere so o bot.js da propria pasta.
$pasta = 'C:\Users\gusta\Scripts\robo-revenda'
$bot = Join-Path $pasta 'bot.js'
$ja = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$bot*" -or $_.CommandLine -match '^"?[^"]*node(\.exe)?"?\s+bot\.js\s*$' }
if ($ja) { exit }
Set-Location $pasta
while ($true) {
  & node $bot | Out-Null
  Start-Sleep -Seconds 15
}
