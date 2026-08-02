@echo off
setlocal
cd /d "%~dp0"

echo Updating song library from Simian exports...
echo.
node scripts\update-song-library.js "G:\Shared drives\Audio Broadcasting\Libaraies\WCYT Library List.csv" "G:\Shared drives\Audio Broadcasting\Libaraies\2 Library List.csv"
if errorlevel 1 (
  echo.
  echo Update failed - see error above. Nothing was committed or pushed.
  pause
  exit /b 1
)

git add planner.html planner-songs.json
git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo No changes to the song library - nothing to commit or push.
  pause
  exit /b 0
)

echo.
git commit -m "Update song library"
git push

echo.
echo Done - song library updated and pushed to wcyt.org.
pause
