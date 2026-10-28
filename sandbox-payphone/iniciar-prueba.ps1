# Ejecuta únicamente desde un equipo privado y con credenciales comprobadas en Prueba.
$ErrorActionPreference = 'Stop'
$busy = Get-NetTCPConnection -LocalPort 8131 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host 'El puerto 8131 está ocupado. Detén el servidor anterior con Ctrl+C en su propia terminal y vuelve a ejecutar este archivo.'
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'No se encontró Node. Instala Node 24 y vuelve a intentarlo.'
  exit 1
}

Write-Host 'Usa solamente credenciales de una aplicación PayPhone verificada en el ambiente de pruebas.'
$sandboxSecret = $null
$sandboxPtr = [IntPtr]::Zero
$sandboxMoved = $false
try {
  $sandboxSecret = Read-Host 'Token de prueba (no se muestra al escribir)' -AsSecureString
  if (-not $sandboxSecret -or $sandboxSecret.Length -eq 0) { throw 'No se ingresó un token.' }
  $sandboxStore = Read-Host 'Store ID de prueba'
  if ([string]::IsNullOrWhiteSpace($sandboxStore)) { throw 'No se ingresó el Store ID.' }
  $sandboxTunnel = Read-Host 'Origen HTTPS del túnel privado (Enter para solo localhost)'
  if ($sandboxTunnel -and $sandboxTunnel -cnotmatch '^https://[a-z0-9-]+\.use\.devtunnels\.ms$') { throw 'Origen del túnel no válido.' }
  $sandboxPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sandboxSecret)
  $env:PAYPHONE_TEST_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($sandboxPtr)
  $env:PAYPHONE_TEST_STORE_ID = $sandboxStore
  $env:PAYPHONE_SANDBOX_ENABLED = '1'
  $env:PAYPHONE_SANDBOX_VERIFIED = '1'
  $env:PAYPHONE_TEST_TUNNEL_ORIGIN = $sandboxTunnel
  Push-Location (Split-Path $PSScriptRoot -Parent)
  $sandboxMoved = $true
  Write-Host 'Abre http://localhost:8131/renovacion.html en esta computadora. Para detener, pulsa Ctrl+C.'
  & node sandbox-payphone/server.mjs
  if ($LASTEXITCODE -ne 0) { throw 'El servidor de prueba se detuvo con un error.' }
} catch {
  Write-Host 'No se pudo iniciar o mantener el servidor. Verifica el puerto, Node y las credenciales de prueba.'
  exit 1
} finally {
  if ($sandboxMoved) { Pop-Location }
  if ($sandboxPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sandboxPtr) }
  $sandboxSecret = $null
  $sandboxStore = $null
  Remove-Item Env:PAYPHONE_TEST_TOKEN, Env:PAYPHONE_TEST_STORE_ID, Env:PAYPHONE_SANDBOX_ENABLED, Env:PAYPHONE_SANDBOX_VERIFIED, Env:PAYPHONE_TEST_TUNNEL_ORIGIN -ErrorAction SilentlyContinue
}
