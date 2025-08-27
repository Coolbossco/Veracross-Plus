@echo off
REM Veracross Plus - Cross-Browser Build Script for Windows
setlocal enabledelayedexpansion

echo 🔧 Building Veracross Plus for Chrome and Firefox...

REM Create dist directory
if not exist dist mkdir dist

REM Clean previous builds
echo 🧹 Cleaning previous builds...
if exist dist\chrome rmdir /s /q dist\chrome
if exist dist\firefox rmdir /s /q dist\firefox
if exist dist\*.zip del /q dist\*.zip

REM Build Chrome version
echo 🟡 Building Chrome version...
mkdir dist\chrome
copy manifest-chrome.json dist\chrome\manifest.json >nul 2>&1
copy *.js dist\chrome\ >nul 2>&1
copy *.css dist\chrome\ >nul 2>&1  
copy *.html dist\chrome\ >nul 2>&1
xcopy icons dist\chrome\icons\ /E /I >nul 2>&1

REM Build Firefox version
echo 🔥 Building Firefox version...
mkdir dist\firefox
copy manifest-firefox.json dist\firefox\manifest.json >nul 2>&1
copy *.js dist\firefox\ >nul 2>&1
copy *.css dist\firefox\ >nul 2>&1
copy *.html dist\firefox\ >nul 2>&1
xcopy icons dist\firefox\icons\ /E /I >nul 2>&1

REM Create ZIP packages (requires PowerShell on Windows)
echo 📦 Creating distribution packages...
powershell -command "Compress-Archive -Path 'dist\chrome\*' -DestinationPath 'dist\veracross-plus-chrome.zip' -Force"
powershell -command "Compress-Archive -Path 'dist\firefox\*' -DestinationPath 'dist\veracross-plus-firefox.zip' -Force"

echo ✅ Build complete!
echo 📁 Chrome package: dist\veracross-plus-chrome.zip
echo 📁 Firefox package: dist\veracross-plus-firefox.zip
echo.
echo 🚀 Ready for deployment to Chrome Web Store and Firefox Add-ons!

pause