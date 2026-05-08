@echo off
:: Execute este arquivo UMA VEZ para abrir o Chrome com debug ativado.
:: Depois mantenha o Chrome aberto — o crawler vai abrir novas abas nele.
:: Se o Chrome já estiver aberto, feche-o antes de rodar este arquivo.

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

start "" %CHROME% --remote-debugging-port=9222
