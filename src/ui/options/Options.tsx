import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Shield, Cloud, CreditCard, Info, User, ExternalLink, Moon, Sun, Monitor, RefreshCw } from 'lucide-react';
import { getAuthState, logout, type AuthState } from '../../storage/AuthService';
import { getSubscriptionInfo, createPortalSession, createCheckoutSession, type SubscriptionInfo } from '../../storage/EntitlementService';
import { getSyncManager, type SyncState, type SyncError } from '../../sync/SyncManager';
import { getStorageProvider } from '../../storage/LocalStorageProvider';
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from '../../models/UserPreferences';

interface FeatureItemProps {
    id: string;
    title: string;
    description: string;
    isActive: boolean;
    requiresPremium?: boolean;
    isSubscribed?: boolean;
}

const FeatureItem: React.FC<FeatureItemProps> = ({ title, description, isActive, requiresPremium, isSubscribed }) => (
    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-all hover:bg-white hover:shadow-sm">
        <div>
            <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-800">{title}</p>
                {requiresPremium && (
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase tracking-tight">Pro</span>
                )}
            </div>
            <p className="text-sm text-slate-500">{description}</p>
        </div>
        <span className={`text-sm font-medium px-3 py-1 rounded-full transition-colors ${isActive
            ? 'text-emerald-600 bg-emerald-50'
            : 'text-slate-400 bg-slate-100'
            }`}>
            {isActive ? 'Active' : 'Disabled'}
        </span>
    </div>
);

const Toggle: React.FC<{
    label: string,
    enabled: boolean,
    onToggle: () => void,
    description?: string,
    premiumOnly?: boolean,
    isSubscribed?: boolean
}> = ({ label, enabled, onToggle, description, premiumOnly, isSubscribed }) => {
    const isDisabled = premiumOnly && !isSubscribed;

    return (
        <div className={`group flex items-center justify-between p-4 rounded-2xl transition-all ${isDisabled ? 'opacity-50' : 'hover:bg-slate-50'}`}>
            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-700">{label}</p>
                    {premiumOnly && (
                        <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded uppercase tracking-tight">Pro</span>
                    )}
                </div>
                {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
            </div>
            <button
                onClick={onToggle}
                disabled={isDisabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${enabled ? 'bg-blue-600' : 'bg-slate-200'
                    } ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
            </button>
        </div>
    );
};

export default function Options() {
    const [authState, setAuthState] = useState<AuthState | null>(null);
    const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
    const [syncState, setSyncState] = useState<{ state: SyncState; error: SyncError | null; isOffline: boolean }>({
        state: 'idle',
        error: null,
        isOffline: false
    });
    const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
    const [loading, setLoading] = useState(true);
    const [portalLoading, setPortalLoading] = useState(false);
    const [loadingPlan, setLoadingPlan] = useState<'monthly' | 'yearly' | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [version, setVersion] = useState('0.0.0');

    const fetchData = useCallback(async (forceRefresh = false) => {
        const auth = await getAuthState();
        setAuthState(auth);

        const sub = await getSubscriptionInfo(forceRefresh);
        setSubscription(sub);

        const storage = getStorageProvider();
        const storedPrefs = await storage.get<UserPreferences>('vcp_preferences');
        if (storedPrefs) setPrefs(storedPrefs);

        const syncManager = getSyncManager();
        setSyncState(syncManager.getState());

        if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
            setVersion(chrome.runtime.getManifest().version);
        }

        setLoading(false);
    }, []);

    useEffect(() => {
        fetchData();

        const syncManager = getSyncManager();
        const unsubscribe = syncManager.onStateChange((state, error) => {
            setSyncState({
                state,
                error: (error as SyncError) || null,
                isOffline: !navigator.onLine
            });

            // If sync failed due to subscription, refresh the entire dashboard state (FORCE refresh)
            if (error?.message.includes("Subscription Required")) {
                fetchData(true);
            }
        });

        return () => unsubscribe();
    }, [fetchData]);

    useEffect(() => {
        // Check for checkout success
        const params = new URLSearchParams(window.location.search);
        if (params.get('checkout') === 'success') {
            setSuccessMessage("Subscription Activated!");
            fetchData(true); // Force refresh entitlement state

            // Clean up URL to prevent re-triggering on refresh
            const newUrl = window.location.pathname + window.location.hash;
            window.history.replaceState({}, '', newUrl);

            // Clear message after delay
            setTimeout(() => setSuccessMessage(null), 5000);
        }
    }, [fetchData]);

    const handleTogglePref = async (key: keyof UserPreferences) => {
        const newPrefs = { ...prefs, [key]: !prefs[key] };
        setPrefs(newPrefs);
        const storage = getStorageProvider();
        await storage.set('vcp_preferences', newPrefs);
    };

    const handleManageSubscription = async () => {
        setPortalLoading(true);
        try {
            const returnUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
                ? chrome.runtime.getURL('src/ui/options/options.html')
                : window.location.href;

            const res = await createPortalSession(returnUrl);
            if (res.success && res.portalUrl) {
                window.location.href = res.portalUrl;
            } else {
                alert(res.error || "Failed to open billing portal");
            }
        } catch (err) {
            alert("Connection error");
        } finally {
            setPortalLoading(false);
        }
    };

    const handleSyncNow = async () => {
        const syncManager = getSyncManager();
        await syncManager.sync();
        await fetchData(); // Refresh UI state after sync (catches entitlement changes)
    };

    const handleUpgrade = async (plan: 'monthly' | 'yearly') => {
        setLoadingPlan(plan);
        try {
            const returnUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
                ? chrome.runtime.getURL('src/ui/options/options.html')
                : window.location.href;

            const res = await createCheckoutSession(plan, returnUrl);
            if (res.success && res.checkoutUrl) {
                window.location.href = res.checkoutUrl;
            } else {
                setLoadingPlan(null);
                alert(res.error || "Failed to start checkout");
            }
        } catch (err) {
            setLoadingPlan(null);
            alert("Connection error");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
                    <p className="text-slate-500 font-medium">Loading Dashboard...</p>
                </div>
            </div>
        );
    }

    const isPaidSubscribed = !!subscription?.isSubscribed;
    const canAccessPro = !!(subscription?.isSubscribed || subscription?.isGrandfathered);

    return (
        <div className="relative bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 overflow-visible">
            <div className="ambient-glow fixed inset-0 pointer-events-none z-0 opacity-50 overflow-hidden">
                <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-400/10 blur-[120px] rounded-full animate-drift" />
                <div className="absolute top-[20%] -right-[10%] w-[35%] h-[35%] bg-purple-400/10 blur-[120px] rounded-full animate-drift-slow" />
            </div>

            {successMessage && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 border border-emerald-400">
                        <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center font-bold text-[10px]">✓</div>
                        <p className="font-bold tracking-tight">{successMessage}</p>
                    </div>
                </div>
            )}

            <main className="relative z-10 max-w-5xl mx-auto px-6 py-16">
                <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">Dashboard</h1>
                        <p className="text-slate-500 text-lg">Control and monitor your Veracross Plus experience.</p>
                    </div>
                    {authState?.isLoggedIn && (
                        <button
                            onClick={() => logout().then(() => setAuthState(null))}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-500 hover:text-red-600 transition-colors bg-white rounded-xl border border-slate-200 shadow-sm"
                        >
                            Sign Out
                        </button>
                    )}
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Left Column: Status & Features */}
                    <div className="md:col-span-2 space-y-8">
                        {/* 1. System Status */}
                        <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60 transition-all hover:shadow-md">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                                    <Shield size={24} />
                                </div>
                                <h2 className="text-xl font-semibold">System Status</h2>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Identity</p>
                                    <p className="text-lg font-medium text-slate-700 truncate">
                                        {authState?.isLoggedIn ? authState.user?.email : 'Guest Mode'}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Membership</p>
                                    <div className="flex items-center gap-2">
                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold uppercase tracking-tight ${subscription?.isSubscribed
                                            ? 'bg-blue-100 text-blue-700'
                                            : subscription?.isGrandfathered ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                            }`}>
                                            {subscription?.isSubscribed ? `${subscription.plan} Member` : subscription?.isGrandfathered ? 'Legacy Access' : 'Free Plan'}
                                        </span>
                                    </div>
                                </div>
                                {authState?.isLoggedIn && (
                                    <>
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Sync Health</p>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2.5 h-2.5 rounded-full ${syncState.isOffline ? 'bg-slate-400' :
                                                    syncState.state === 'error' ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'
                                                    }`} />
                                                <p className="text-lg font-medium text-slate-700 capitalize">
                                                    {syncState.isOffline ? 'Offline' : (
                                                        syncState.state === 'idle' ? 'Up to Date' :
                                                            syncState.state === 'checking' ? 'Checking...' :
                                                                syncState.state === 'pushing' || syncState.state === 'pulling' ? 'Syncing...' :
                                                                    syncState.state === 'success' ? 'Sync Complete' :
                                                                        syncState.state === 'error' ? 'Sync Error' :
                                                                            syncState.state === 'quiet_error' ? 'Retrying...' :
                                                                                syncState.state
                                                    )}
                                                </p>
                                            </div>
                                            {syncState.error && (
                                                <p className="text-xs text-red-500 mt-1">{syncState.error.message}</p>
                                            )}
                                        </div>
                                        <div className="pt-2">
                                            <button
                                                onClick={handleSyncNow}
                                                disabled={syncState.state === 'pushing' || syncState.state === 'pulling' || syncState.isOffline}
                                                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-50"
                                            >
                                                <RefreshCw size={16} className={syncState.state === 'pushing' || syncState.state === 'pulling' ? 'animate-spin' : ''} />
                                                Sync Now
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>

                        {/* 2. Feature Access */}
                        <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60 transition-all hover:shadow-md">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                                    <Settings size={24} />
                                </div>
                                <h2 className="text-xl font-semibold">Active Features</h2>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FeatureItem
                                    id="checklist"
                                    title="Checkboxes"
                                    description="Interactive task tracking"
                                    isActive={prefs.enableChecklist}
                                />
                                <FeatureItem
                                    id="custom"
                                    title="Custom Tasks"
                                    description="Personal assignment support"
                                    isActive={prefs.enableCustomAssignments}
                                    requiresPremium={true}
                                    isSubscribed={canAccessPro}
                                />
                                <FeatureItem
                                    id="cloud"
                                    title="Cloud Sync"
                                    description="Multi-device data persistence"
                                    isActive={!!(authState?.isLoggedIn && isPaidSubscribed)}
                                    requiresPremium={true}
                                    isSubscribed={isPaidSubscribed}
                                />
                            </div>
                        </section>

                        {/* 4. Veracross Plus Cloud Section */}
                        <section className="bg-slate-900 text-white rounded-3xl p-8 shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 blur-[100px] pointer-events-none" />
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-500/20 text-blue-400 rounded-xl">
                                        <Cloud size={24} />
                                    </div>
                                    <h2 className="text-xl font-semibold text-white">Veracross Plus Cloud</h2>
                                </div>
                                {isPaidSubscribed && (
                                    <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Active</span>
                                )}
                            </div>

                            {authState?.isLoggedIn ? (
                                isPaidSubscribed ? (
                                    <div className="space-y-6">
                                        <p className="text-slate-400 leading-relaxed max-w-2xl">
                                            Your subscription is active. All features including Cloud Sync and Custom Tasks are fully available across your devices.
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                            <div className="p-5 bg-white/5 rounded-2xl border border-white/10">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2">Renew Price</p>
                                                <p className="text-sm text-slate-200 font-medium">
                                                    {subscription?.plan === 'yearly' ? '$24.99' : '$2.99'}
                                                </p>
                                            </div>
                                            <div className="p-5 bg-white/5 rounded-2xl border border-white/10">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2">Plan Type</p>
                                                <p className="text-sm text-slate-200 font-medium capitalize">{subscription?.plan || 'Pro'} Tier</p>
                                            </div>
                                            <div className="p-5 bg-white/5 rounded-2xl border border-white/10">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-2">Renew Date</p>
                                                <p className="text-sm text-slate-200 font-medium">
                                                    {subscription?.subscriptionEnd ? new Date(subscription.subscriptionEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '---'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-8">
                                        <div className="space-y-4">
                                            <p className="text-slate-200 text-lg font-medium">Upgrade for the ultimate experience.</p>
                                            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {[
                                                    'Seamless Cloud Synchronization',
                                                    'Unlimited Custom Tasks',
                                                    'Multi-Device Persistence',
                                                    'Priority Support Access'
                                                ].map((feature, i) => (
                                                    <li key={i} className="flex items-center gap-2 text-sm text-slate-400">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                        {feature}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <div className="flex flex-col sm:flex-row gap-4">
                                            <button
                                                onClick={() => handleUpgrade('yearly')}
                                                disabled={loadingPlan !== null}
                                                className="flex-1 bg-white text-slate-900 font-bold py-4 px-6 rounded-2xl hover:bg-slate-100 transition-all flex flex-col items-center gap-0.5 disabled:opacity-50"
                                            >
                                                {loadingPlan === 'yearly' ? (
                                                    <div className="flex items-center gap-2">
                                                        <RefreshCw size={18} className="animate-spin" />
                                                        <span>Opening...</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <span>$24.99 / Year</span>
                                                        <span className="text-[10px] text-emerald-600 font-extrabold tracking-tight uppercase">Best Value • Save 30%</span>
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => handleUpgrade('monthly')}
                                                disabled={loadingPlan !== null}
                                                className="flex-1 bg-slate-800 text-white font-bold py-4 px-6 rounded-2xl hover:bg-slate-700 transition-all border border-white/10 flex flex-col items-center justify-center disabled:opacity-50"
                                            >
                                                {loadingPlan === 'monthly' ? (
                                                    <div className="flex items-center gap-2">
                                                        <RefreshCw size={18} className="animate-spin" />
                                                        <span>Opening...</span>
                                                    </div>
                                                ) : (
                                                    <span>$2.99 / Month</span>
                                                )}
                                            </button>
                                        </div>

                                        <div className="pt-4 border-t border-white/5">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Current Tier</p>
                                            <p className="text-sm text-slate-400">
                                                {subscription?.isGrandfathered ? 'Legacy Access (Custom Tasks Only)' : 'Free Plan (Limited Features)'}
                                            </p>
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="space-y-6">
                                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-sm">
                                        <p className="text-slate-200 text-lg font-medium mb-4">Cloud synchronization is currently disabled.</p>
                                        <p className="text-slate-400 text-sm leading-relaxed mb-6">
                                            Sign in to your Veracross Plus account to enable Cloud Sync, Custom Tasks, and multi-device data persistence.
                                        </p>
                                        <div className="flex flex-col gap-3">
                                            <button
                                                onClick={() => {
                                                    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
                                                        window.open(chrome.runtime.getURL('popup.html'), '_blank');
                                                    } else {
                                                        window.open('/popup.html', '_blank');
                                                    }
                                                }}
                                                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                                            >
                                                <User size={20} />
                                                Sign In via Extension
                                            </button>
                                            <p className="text-[10px] text-slate-500 text-center uppercase tracking-widest font-bold">
                                                Safe & Secure Authentication
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Right Column: Actions & Info */}
                    <div className="space-y-8">
                        {/* 3. Subscription Control */}
                        {authState?.isLoggedIn && (
                            <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60 transition-all hover:shadow-md">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                                        <CreditCard size={24} />
                                    </div>
                                    <h2 className="text-xl font-semibold">Subscription</h2>
                                </div>
                                <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                                    Manage your billing details, update your payment method, or change your plan.
                                </p>
                                <button
                                    onClick={handleManageSubscription}
                                    disabled={portalLoading}
                                    className="w-full py-4 px-6 bg-slate-900 hover:bg-black text-white font-bold rounded-2xl transition-all shadow-xl shadow-slate-200 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {portalLoading ? 'Opening...' : 'Billing Portal'}
                                    <ExternalLink size={16} />
                                </button>
                                {subscription?.grandfatherCutoff && (
                                    <p className="text-[11px] text-slate-400 mt-4 text-center">
                                        Legacy access valid until {new Date(subscription.grandfatherCutoff).toLocaleDateString()}
                                    </p>
                                )}
                            </section>
                        )}

                        {/* 5. Preferences */}
                        <section className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200/60">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-slate-100 text-slate-600 rounded-xl">
                                    <User size={24} />
                                </div>
                                <h2 className="text-xl font-semibold">Preferences</h2>
                            </div>
                            <div className="divide-y divide-slate-100 -mx-4">
                                <Toggle
                                    label="Task Checkboxes"
                                    enabled={prefs.enableChecklist}
                                    onToggle={() => handleTogglePref('enableChecklist')}
                                    description="Show completion boxes on timeline"
                                />
                                <Toggle
                                    label="Custom Tasks"
                                    enabled={prefs.enableCustomAssignments}
                                    onToggle={() => handleTogglePref('enableCustomAssignments')}
                                    description="Enable adding personal assignments"
                                    premiumOnly={true}
                                    isSubscribed={canAccessPro}
                                />
                            </div>
                        </section>

                        {/* 6. Transparency */}
                        <section className="p-8">
                            <div className="flex items-center gap-3 mb-6 opacity-60">
                                <Info size={20} />
                                <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">Transparency</h2>
                            </div>
                            <div className="space-y-4 text-sm font-medium">
                                <div className="flex justify-between text-slate-400">
                                    <span>Version</span>
                                    <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">{version}</span>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        </div>
    );
}
