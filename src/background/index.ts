const parseVersion = (version: string) => {
    const [major, minor, patch] = version.split('.').map(Number);
    return { major, minor, patch };
};

const isMeaningfulUpdate = (oldVer: string, newVer: string) => {
    if (!oldVer) return true;

    const oldV = parseVersion(oldVer);
    const newV = parseVersion(newVer);

    // Consider major or minor version changes as meaningful
    if (newV.major !== oldV.major) return true;
    if (newV.minor !== oldV.minor) return true;

    // Patch changes are considered silent updates (bug fixes)
    return false;
};

chrome.runtime.onInstalled.addListener(async (details) => {
    const currentVersion = chrome.runtime.getManifest().version;

    if (details.reason === 'install') {
        // Fresh install - store version but don't open update page
        console.log('Veracross Plus installed:', currentVersion);
        await chrome.storage.local.set({ lastSeenVersion: currentVersion });

    } else if (details.reason === 'update') {
        const data = await chrome.storage.local.get('lastSeenVersion');
        const lastSeenVersion = data.lastSeenVersion || details.previousVersion;

        console.log('Veracross Plus updated:', { from: lastSeenVersion, to: currentVersion });

        if (isMeaningfulUpdate(lastSeenVersion, currentVersion)) {
            console.log('Meaningful update detected, opening What\'s New page');
            chrome.tabs.create({
                url: chrome.runtime.getURL('src/ui/updates/updates.html')
            });
        } else {
            console.log('Silent update (patch version or no change), skipping What\'s New page');
        }

        // Always update the stored version
        await chrome.storage.local.set({ lastSeenVersion: currentVersion });
    }
});
