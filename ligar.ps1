# Liga o robo da revenda escondido e religa sozinho se ele cair.
# Abre junto com o Windows (atalho na pasta Inicializar).
$pasta = 'C:\Users\gusta\Scripts\robo-revenda'
$ja = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bot.js*' }
if ($ja) { exit }
Set-Location $pasta
while ($true) {
  & node bot.js | Out-Null
  Start-Sleep -Seconds 15
}
