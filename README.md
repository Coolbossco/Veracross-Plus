# Veracross Plus - Cross-Browser Development Guide

## Overview

Veracross Plus now supports both **Chrome** and **Firefox** browsers using a dual manifest approach. This ensures maximum compatibility while maintaining a single codebase.

## Project Structure

```
v+/
├── content.js              # Main content script (universal)
├── popup.js               # Popup launcher (universal)
├── window.js              # Settings window logic (universal)
├── styles.css             # Extension styles (universal)
├── popup.html             # Popup HTML (universal)
├── window.html            # Settings window HTML (universal)
├── options.html           # Options page (universal)
├── manifest-chrome.json   # Chrome-specific manifest (Manifest V3)
├── manifest-firefox.json  # Firefox-specific manifest (Manifest V2)
├── package.json           # Build configuration
├── build.sh              # Unix/Linux/Mac build script
├── build.bat             # Windows build script
└── dist/                 # Generated distribution files
    ├── chrome/           # Chrome extension files
    ├── firefox/          # Firefox extension files
    ├── veracross-plus-chrome.zip
    └── veracross-plus-firefox.zip
```

## Quick Start

### Building for Both Browsers

**Option 1: Using npm scripts (recommended)**
```bash
npm run build           # Build both Chrome and Firefox versions
npm run build:chrome    # Build Chrome version only
npm run build:firefox   # Build Firefox version only
```

**Option 2: Using shell scripts**
```bash
# Unix/Linux/Mac
./build.sh

# Windows
build.bat
```

### Development Workflow

1. **Make changes** to the universal files (`*.js`, `*.css`, `*.html`)
2. **Test in Chrome** during development (uses `manifest.json` symlink)
3. **Build and test** both versions before deployment
4. **Deploy** the appropriate ZIP files to each store

## Browser Differences

### Manifest Versions
- **Chrome**: Uses Manifest V3 (`manifest-chrome.json`)
- **Firefox**: Uses Manifest V2 (`manifest-firefox.json`)

### Key Differences
| Feature | Chrome (V3) | Firefox (V2) |
|---------|-------------|--------------|
| Action | `action` | `browser_action` |
| Host Permissions | `host_permissions` | Included in `permissions` |
| Service Workers | Supported | Uses background scripts |
| API Namespace | `chrome.*` | `browser.*` (but `chrome.*` works too) |

### Code Compatibility
The extension code is **100% compatible** between browsers because:
- Firefox supports the `chrome.*` API namespace for compatibility
- All used APIs (`storage`, `windows`, `runtime`) work identically
- No browser-specific code changes needed

## Development Commands

### Build Commands
```bash
# Full build process
npm run build

# Individual browser builds
npm run build:chrome
npm run build:firefox

# Development builds (no ZIP packaging)
npm run dev:chrome
npm run dev:firefox

# Clean build artifacts
npm run clean
```

### Testing
```bash
# Validate extensions (placeholder for future validation tools)
npm run validate
```

## Deployment Guide

### Chrome Web Store
1. Build Chrome version: `npm run build:chrome`
2. Upload `dist/veracross-plus-chrome.zip` to Chrome Developer Dashboard
3. Follow Chrome Web Store review process

### Firefox Add-ons (AMO)
1. Build Firefox version: `npm run build:firefox`
2. Upload `dist/veracross-plus-firefox.zip` to Firefox Add-on Developer Hub
3. Follow Mozilla Add-ons review process

### Manual Installation (Development)

**Chrome:**
1. Run `npm run dev:chrome`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `dist/chrome/`

**Firefox:**
1. Run `npm run dev:firefox`
2. Open `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on"
4. Select `dist/firefox/manifest.json`

## Features Supported

All features work identically in both browsers:
- ✅ Homework Checkboxes
- ✅ Grade Estimator
- ✅ Home Page Redirect
- ✅ Custom Assignments
- ✅ Custom Popup Window
- ✅ Settings Persistence
- ✅ Veracross Domain Injection

## Browser API Compatibility

| API | Chrome | Firefox | Notes |
|-----|--------|---------|-------|
| `chrome.storage.sync` | ✅ | ✅ | Works with `chrome.*` namespace |
| `chrome.windows.create` | ✅ | ✅ | Popup window creation |
| `chrome.runtime.getURL` | ✅ | ✅ | Resource URL resolution |
| Content Scripts | ✅ | ✅ | DOM injection and manipulation |
| CSS Injection | ✅ | ✅ | Style application |

## Troubleshooting

### Build Issues
- **Permission denied on build.sh**: Run `chmod +x build.sh`
- **Missing dist directory**: Build scripts create it automatically
- **ZIP creation fails**: Ensure you have `zip` (Unix) or PowerShell (Windows)

### Extension Issues
- **Storage not syncing**: Check browser sync settings
- **Popup not opening**: Verify manifest permissions
- **Content script not injecting**: Check URL patterns in manifest

### Browser-Specific Issues

**Chrome:**
- Ensure Manifest V3 compliance
- Check `host_permissions` syntax

**Firefox:**
- Ensure Manifest V2 format
- Check `permissions` includes all URLs
- Verify `web_accessible_resources` if needed

## Contributing

When making changes:
1. Edit the universal files (`*.js`, `*.css`, `*.html`)
2. Update both manifest files if permissions change
3. Test in both browsers before committing
4. Update version numbers in all manifest files and `package.json`

## Version Management

Update versions in these files:
- `package.json`
- `manifest-chrome.json`
- `manifest-firefox.json`

Keep all version numbers synchronized.

## Custom Assignments Feature

The Custom Assignments feature allows users to create and manage their own assignments within the Veracross timeline.

### Feature Overview

**Custom Assignments** can be:
1. **New Assignments**: Custom assignments that appear in a dedicated row at the top of the timeline
### How It Works

1. **Enable the Feature**: Toggle "Custom Assignments" in the extension popup
2. **Add Assignments**: Click "Add Custom Assignment" to create new assignments
3. **Assignment Types**:
   - Assignments appear in a blue-highlighted row at the top
4. **Management**: Edit or delete assignments from the popup interface

### Assignment Properties

Each custom assignment includes:
- **Title**: The assignment name (required)
- **Description**: Optional details about the assignment
- **Due Date**: When the assignment is due (required)
- **Class/Subject**: Optional class or subject name


### Visual Design

**Regular Custom Assignments**:
- Appear in a dedicated row with blue styling (`#f8f9fa` background, `#007bff` border)
- Individual assignments have light blue backgrounds (`#e3f2fd`)
- Hover effects for better interactivity



### Technical Implementation

**Storage**: Custom assignments are stored in Chrome sync storage as `customAssignments` array

**Injection Logic**:
- Regular assignments: Injected at the top of the timeline table
- Date matching: Assignments appear in appropriate timeline columns

**Integration**: Works seamlessly with existing checkbox system for task completion tracking

---

**Happy cross-browser development! 🚀**