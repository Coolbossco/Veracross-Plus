# Veracross Plus

Enhanced Veracross portal experience with homework checklists, grade estimation, custom assignments, and more.

## Architecture Overview (Phase 1)

Veracross Plus follows a modular architecture designed for maintainability, type safety, and future extensibility (cloud sync, accounts, etc.).

### Project Structure

```
Extension/
├── src/
│   ├── content/              # Content script (injected into Veracross pages)
│   │   ├── index.ts          # Main content script
│   │   └── styles.css        # Injected styles
│   │
│   ├── models/               # Data models (Phase 1)
│   │   ├── Assignment.ts     # Assignment & CustomAssignment types
│   │   ├── Completion.ts     # Completion state tracking
│   │   ├── UserPreferences.ts # User settings model
│   │   └── index.ts          # Central exports
│   │
│   ├── storage/              # Storage abstraction layer (Phase 1)
│   │   ├── StorageProvider.ts    # Storage interface
│   │   ├── LocalStorageProvider.ts # chrome.storage.sync implementation
│   │   └── index.ts          # Central exports
│   │
│   ├── features/             # Feature flag system (Phase 1)
│   │   ├── FeatureFlags.ts   # Feature flag management
│   │   └── index.ts          # Central exports
│   │
│   ├── migrations/           # Data versioning & migrations (Phase 1)
│   │   └── index.ts          # Migration runner
│   │
│   ├── ui/                   # UI components
│   │   ├── popup/            # Extension popup
│   │   ├── window/           # Settings window
│   │   └── options/          # Options page
│   │
│   └── assets/               # Static assets
│       └── icons/            # Extension icons
│
├── dist/                     # Build output
├── vite.config.ts            # Vite build configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies & scripts
├── PRIVACY.md                # Privacy policy (draft)
└── README.md                 # This file
```

### Key Modules

#### Data Models (`src/models/`)

Type-safe data structures for all extension data:

- **`Assignment.ts`**: Custom assignment model with migration support
- **`Completion.ts`**: Checkbox/completion state tracking
- **`UserPreferences.ts`**: User settings and preferences

#### Storage Layer (`src/storage/`)

Abstracted storage for easy testing and future cloud sync:

```typescript
import { getStorageProvider, STORAGE_KEYS } from "./storage";

const storage = getStorageProvider();
const assignments = await storage.get(STORAGE_KEYS.CUSTOM_ASSIGNMENTS);
```

#### Feature Flags (`src/features/`)

Centralized feature control:

```typescript
import { isFeatureEnabled } from "./features";

if (isFeatureEnabled("enableChecklist")) {
  applyChecklist();
}
```

#### Migrations (`src/migrations/`)

Safe data migrations for updates:

```typescript
import { initializeDataVersioning } from "./migrations";

await initializeDataVersioning(); // Runs on startup
```

## Quick Start

### Installation

```bash
# Install dependencies (using bun)
bun install
```

### Development

```bash
# Start development server with hot reload
bun run dev
```

### Building

```bash
# Build for production
bun run build

# Type check
bun run typecheck
```

### Loading in Chrome

1. Run `bun run dev` or `bun run build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `dist/chrome/`

## Features

### Homework Checkboxes

Add interactive checkboxes to track assignment completion:

- Works on Timeline, Daily Schedule, and Assignments pages
- Completion state syncs across devices
- Visual feedback with strikethrough and opacity changes

### Custom Assignments

Create and manage your own assignments:

- Appear alongside native Veracross assignments
- Support title, description, due date, and class
- Fully integrated with the checkbox system

### Grade Estimator

Estimate your grade percentages (when enabled).

### Home Redirect

Automatically redirect to a custom page on login.

## Data Storage

All data is stored locally using `chrome.storage.sync`:

| Key | Description |
|-----|-------------|
| `customAssignments` | Array of user-created assignments |
| `vc_checked_assignments` | Map of completed assignment IDs |
| `enableChecklist` | Checkbox feature toggle |
| `enableCustomAssignments` | Custom assignments toggle |
| `vcp_data_version` | Data schema version |

See [PRIVACY.md](./PRIVACY.md) for full privacy details.

## Browser Support

- **Chrome**: Manifest V3 (primary)
- **Firefox**: Manifest V2 (planned)

## Development

### Type Checking

```bash
bun run typecheck
```

### Code Organization Principles

1. **No direct storage access** in feature code — use `StorageProvider`
2. **Type-safe models** for all data structures
3. **Feature flags** for all optional features
4. **Migrations** for any data format changes

### Adding a New Feature

1. Create/update models in `src/models/`
2. Add feature flag in `src/features/FeatureFlags.ts`
3. Implement feature logic
4. Add migration if changing data format

## Version History

- **0.2.1**: Phase 1 architecture (models, storage, feature flags, migrations)
- **0.2.0**: Custom assignments, improved UI
- **0.1.0**: Initial release with checkboxes

## License

MIT

---

**Happy studying! 📚**
