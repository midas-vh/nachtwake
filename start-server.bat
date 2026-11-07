@echo off
cd /d %~dp0
echo.
echo  NACHTWAKE draait op http://localhost:8094
echo  Zet je koptelefoon op. Sluit dit venster om te stoppen.
echo.
start "" http://localhost:8094
py -m http.server 8094
