#!/bin/bash

# Veracross Plus - Cross-Browser Build Script
set -e

echo "🔧 Building Veracross Plus for Chrome and Firefox..."

# Create dist directory
mkdir -p dist

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/chrome dist/firefox
rm -f dist/*.zip

# Build Chrome version
echo "🟡 Building Chrome version..."
mkdir -p dist/chrome
cp manifest-chrome.json dist/chrome/manifest.json
cp *.js *.css *.html dist/chrome/ 2>/dev/null || true
cp -r icons dist/chrome/ 2>/dev/null || true

# Build Firefox version  
echo "🔥 Building Firefox version..."
mkdir -p dist/firefox
cp manifest-firefox.json dist/firefox/manifest.json
cp *.js *.css *.html dist/firefox/ 2>/dev/null || true
cp -r icons dist/firefox/ 2>/dev/null || true

# Create ZIP packages
echo "📦 Creating distribution packages..."
cd dist/chrome && zip -r ../veracross-plus-chrome.zip . && cd ../..
cd dist/firefox && zip -r ../veracross-plus-firefox.zip . && cd ../..

echo "✅ Build complete!"
echo "📁 Chrome package: dist/veracross-plus-chrome.zip"
echo "📁 Firefox package: dist/veracross-plus-firefox.zip"
echo ""
echo "🚀 Ready for deployment to Chrome Web Store and Firefox Add-ons!"