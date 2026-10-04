@echo off
cd /d "C:\Users\Andy\WCYT-Website"

python scripts\build_music_library.py
if errorlevel 1 (
  echo Build failed - nothing committed.
  exit /b 1
)

git add images\music_library.json
git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to the music library - nothing to commit.
  exit /b 0
)

git commit -m "Nightly music library rebuild"
git push
