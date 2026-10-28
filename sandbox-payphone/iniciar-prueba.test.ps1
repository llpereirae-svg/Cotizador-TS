# Ejecutar en una sesión de PowerShell independiente. No abre puertos ni red.
$ErrorActionPreference = 'Stop'
function global:Get-NetTCPConnection { param($LocalPort, $State, $ErrorAction) return $null }
function global:Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  if ($AsSecureString) { return ConvertTo-SecureString 'token-ficticio' -AsPlainText -Force }
  return 'tienda-ficticia'
}
function global:node {
  if ($env:PAYPHONE_TEST_TOKEN -ne 'token-ficticio' -or $env:PAYPHONE_TEST_STORE_ID -ne 'tienda-ficticia' -or
      $env:PAYPHONE_SANDBOX_ENABLED -ne '1' -or $env:PAYPHONE_SANDBOX_VERIFIED -ne '1') {
    throw 'El lanzador no entregó la configuración esperada al proceso simulado.'
  }
  $global:LASTEXITCODE = 0
}
& (Join-Path $PSScriptRoot 'iniciar-prueba.ps1')
foreach ($name in 'PAYPHONE_TEST_TOKEN', 'PAYPHONE_TEST_STORE_ID', 'PAYPHONE_SANDBOX_ENABLED', 'PAYPHONE_SANDBOX_VERIFIED') {
  if (Test-Path "Env:$name") { throw 'El lanzador no limpió una variable temporal.' }
}
Write-Host 'Lanzador probado con credenciales ficticias y proceso simulado.'
