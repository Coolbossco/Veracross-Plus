# Veracross Plus — Privacy Policy (Draft)

**Last Updated:** December 2024
**Status:** Draft — Not yet published

---

## Overview

Veracross Plus is a browser extension that enhances the Veracross student portal experience. This document describes what data we collect, how we use it, and your rights regarding your data.

**Key Principle:** Veracross Plus is designed to be privacy-first. All data is stored locally on your device by default.

---

## Data We Collect

### Data Stored Locally

All user data is stored in your browser's local storage (`chrome.storage.sync`). This data never leaves your device unless you explicitly enable cloud sync (future feature).

#### 1. User Preferences

- **What:** Feature toggles (e.g., enable checkboxes, custom assignments)
- **Why:** To remember your settings across browser sessions
- **Where:** Browser local storage only

#### 2. Custom Assignments

- **What:** Assignments you create manually (title, due date, class name, description)
- **Why:** To display your custom assignments alongside native Veracross assignments
- **Where:** Browser local storage only

#### 3. Completion State

- **What:** Which assignments you've marked as complete (checkbox state)
- **Why:** To persist your progress tracking across sessions
- **Where:** Browser local storage only

### Data We Do NOT Collect

- ❌ **No personal information** (name, email, student ID)
- ❌ **No Veracross credentials** (passwords, tokens)
- ❌ **No Veracross data** (grades, schedules, native assignments)
- ❌ **No browsing history** outside of Veracross domains
- ❌ **No analytics or tracking** data
- ❌ **No data sent to external servers** (current version)

---

## How We Use Data

All data collected is used solely to provide the extension's features:

| Data Type | Purpose |
|-----------|---------|
| User Preferences | Enable/disable features based on your choices |
| Custom Assignments | Display your assignments in the Veracross interface |
| Completion State | Show checkmarks on assignments you've completed |

---

## Data Storage & Security

### Local Storage

- All data is stored using `chrome.storage.sync` API
- Data is encrypted at rest by your browser
- Data may sync across your Chrome instances if you're signed into Chrome
- This sync is handled by Google Chrome, not by Veracross Plus

### Permissions Used

The extension requires these browser permissions:

| Permission | Reason |
|------------|--------|
| `storage` | To save your preferences and custom assignments |
| `*://*.veracross.com/*` | To inject features into Veracross pages |

---

## Data Sharing

### Current Version

**We do not share any data with third parties.** All data stays on your device.

### Future Versions (Cloud Sync)

In future versions, we may offer optional cloud sync features:

- Cloud sync will be **opt-in only**
- You will be clearly informed before any data leaves your device
- A separate, detailed privacy notice will be provided for cloud features

---

## Data Retention

- **Local data:** Retained until you uninstall the extension or clear browser data
- **No remote retention:** We don't store any data on our servers (current version)

---

## Your Rights

You have full control over your data:

### View Your Data

Open browser DevTools → Application → Storage → Extension Storage

### Delete Your Data

1. Right-click the extension icon → Options
2. Use the "Clear All Data" option (when available)
3. Or: Uninstall the extension to remove all data

### Export Your Data

Data export feature is planned for a future release.

---

## Veracross Data

### What We Access

Veracross Plus reads (but does not store or modify) the following from Veracross pages:

- Assignment names and due dates (to identify where to add checkboxes)
- Class names (to categorize custom assignments)
- Page structure (to inject UI elements)

### What We Don't Do

- ❌ We never store your Veracross data
- ❌ We never modify your Veracross data
- ❌ We never access your grades or personal information
- ❌ We never send Veracross data anywhere

---

## Children's Privacy (COPPA)

Veracross Plus may be used by students under 13. We comply with COPPA by:

- Not collecting any personal information
- Not sharing any data with third parties
- Storing all data locally on the user's device

---

## Changes to This Policy

We may update this privacy policy as the extension evolves. Significant changes will be:

- Announced in extension update notes
- Reflected in the "Last Updated" date above

---

## Contact

For privacy questions or concerns:

- Open an issue on our GitHub repository
- Email: [Contact information to be added]

---

## Technical Details

### Storage Keys Used

| Key | Description |
|-----|-------------|
| `enableChecklist` | Checkbox feature toggle |
| `enableCustomAssignments` | Custom assignments toggle |
| `customAssignments` | Array of user-created assignments |
| `vc_checked_assignments` | Map of completed assignment IDs |
| `vcp_data_version` | Data schema version for migrations |

### Data Format

All data is stored as JSON. Example structure:

```json
{
  "enableChecklist": true,
  "enableCustomAssignments": true,
  "customAssignments": [
    {
      "id": "uuid",
      "title": "Assignment Title",
      "dueDate": "2024-12-25",
      "className": "Math",
      "source": "custom",
      "createdAt": "2024-12-20T10:00:00Z"
    }
  ],
  "vc_checked_assignments": {
    "assignment-key-1": 1,
    "assignment-key-2": 1
  }
}
```

---

*This is a draft privacy policy prepared during Phase 1 development. It will be reviewed and finalized before public release.*

