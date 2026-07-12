@echo off
setlocal enabledelayedexpansion

for %%f in (extracted_texts\*.txt) do (
    echo.
    echo ==========================================
    echo Processing %%f
    set "fileid=%%~nf"
    echo File ID: !fileid!
    node --max-old-space-size=2048 services/processSingleFile.js "%%f" "!fileid!"
    echo.
)
echo.
echo All done.
pause