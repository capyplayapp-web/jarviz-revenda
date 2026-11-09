# Publica a versão celular dos relatórios: copia relatorios\web\ para public\ (sem mock, prints e backups) e roda wrangler deploy.
# Uso:  .\publicar.ps1            (publica)
#       .\publicar.ps1 -SoCopiar  (só prepara public\, não publica)
param([switch]$SoCopiar)
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$origem = 'C:\Users\gusta\Scripts\robo-revenda\relatorios\web'
$destino = Join-Path $aqui 'public'
if (-not (Test-Path (Join-Path $origem 'index.html'))) { throw "Não achei $origem\index.html" }
if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
New-Item -ItemType Directory -Path $destino | Out-Null
$excluirPastas = @('mock', 'prints')
Get-ChildItem $origem -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($origem.Length).TrimStart('\')
  $partes = $rel.Split('\')
  if ($partes.Count -gt 1 -and ($excluirPastas -contains $partes[0])) { return }
  if ($_.Name -like '*.antes-*') { return }
  if ($_.Extension -eq '.cjs') { return }   # scripts de apoio (prints, ícones)
  $alvo = Join-Path $destino $rel
  New-Item -ItemType Directory -Path (Split-Path $alvo) -Force | Out-Null
  Copy-Item $_.FullName $alvo
}
$n = (Get-ChildItem $destino -Recurse -File).Count
Write-Host "public\ pronto: $n arquivos"
if ($SoCopiar) { return }
Push-Location $aqui
try { npx wrangler deploy } finally { Pop-Location }
