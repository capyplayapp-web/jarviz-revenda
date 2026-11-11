# Abre a aba Sigma do dashboard do robô quando o PC liga (pedido do senhor, 09/11/2026).
# Espera o servidor 127.0.0.1:8811 responder (o robô o liga uns segundos depois de subir) e abre no navegador padrão.
$url = 'http://127.0.0.1:8811/?vista=sigma'
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest 'http://127.0.0.1:8811/api/ping' -UseBasicParsing -TimeoutSec 3 | Out-Null; Start-Process $url; exit 0 } catch { Start-Sleep -Seconds 5 }
}
