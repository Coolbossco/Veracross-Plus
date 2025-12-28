import React, { useState, useEffect } from "react";
import {
    Lock,
    Cloud,
    ChevronLeft,
    LogOut,
    RefreshCw,
    CheckCircle2,
    Plus,
    Layers,
    User as UserIcon,
    Loader2,
    LayoutDashboard
} from "lucide-react";
import logo from "../../assets/icons/128.png";
import {
    getStorageProvider,
    getCloudStorageProvider,
    getAuthState,
    login,
    register,
    logout,
    STORAGE_KEYS,
    type AuthState
} from "../../storage";
import { getSyncManager, initializeAutoSync } from "../../sync";
import { initializeFeatureFlags } from "../../features";
import { getSubscriptionInfo, getCachedSubscriptionInfo, type SubscriptionInfo } from "../../storage/EntitlementService";
import { Tooltip } from "../components/Tooltip";
import { trackPopupRenderTime } from "../../sync/TelemetryService";


type View = "onboarding" | "auth-choice" | "auth-form" | "main" | "upgrade";

const Popup: React.FC = () => {
    const [view, setView] = useState<View>("main");
    const [loading, setLoading] = useState(true);
    const [authState, setAuthState] = useState<AuthState>({ isLoggedIn: false, user: null, token: null });
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [authSubmitting, setAuthSubmitting] = useState(false);
    const [upgradeSubmitting, setUpgradeSubmitting] = useState<"monthly" | "yearly" | null>(null);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);
    const [syncSuccess, setSyncSuccess] = useState(true);
    const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
    const [settings, setSettings] = useState({
        enableChecklist: false,
        enableCustomAssignments: false,
    });

    // Performance tracking: track how long until initial UI is ready
    const [mountTime] = useState(Date.now());

    useEffect(() => {
        const init = async () => {
            // Start feature flags init (non-blocking if possible, but we await to ensure consistent state)
            await initializeFeatureFlags();

            // Initialize auto-sync controller for event-driven syncing
            initializeAutoSync();

            const storage = getStorageProvider();
            const isOnboardingComplete = await storage.get<boolean>(STORAGE_KEYS.ONBOARDING_COMPLETE);

            if (!isOnboardingComplete) {
                setView("onboarding");
                setLoading(false);
            } else {
                const state = await getAuthState();
                setAuthState(state);

                const storedSettings = await storage.getMany<Record<string, boolean>>([
                    "enableChecklist",
                    "enableCustomAssignments"
                ]);
                setSettings({
                    enableChecklist: !!storedSettings.enableChecklist,
                    enableCustomAssignments: !!storedSettings.enableCustomAssignments,
                });

                // Optimistic UI: Load cached subscription info first
                const cachedSub = await getCachedSubscriptionInfo();
                if (cachedSub) {
                    setSubscription(cachedSub);
                }

                // Render immediately with cached state
                setView("main");
                setLoading(false);

                // Background revalidation: Fetch fresh info if needed
                getSubscriptionInfo().then(sub => {
                    // Update state only if we got a valid response (or if it changed)
                    // React state updates handle equality checks mostly, but good to be safe
                    if (sub) {
                        setSubscription(sub);
                    }
                });
            }
            setLoading(false);
            trackPopupRenderTime(Date.now() - mountTime);
        };
        init();
    }, []);

    const handleToggle = async (key: keyof typeof settings) => {
        const newVal = !settings[key];
        setSettings(prev => ({ ...prev, [key]: newVal }));
        // Use CloudStorageProvider to trigger auto-sync
        await getCloudStorageProvider().set(key, newVal);
    };

    const handleOnboardingChoice = async (choice: "local" | "cloud") => {
        if (choice === "local") {
            await getStorageProvider().set(STORAGE_KEYS.ONBOARDING_COMPLETE, true);
            setView("main");
        } else {
            setView("auth-choice");
        }
    };

    const handleAuthSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) {
            setAuthError("Please fill in all fields");
            return;
        }

        setAuthError("");
        setAuthSubmitting(true);
        try {
            const res = authMode === "login"
                ? await login(email, password)
                : await register(email, password);

            if (res.success) {
                await getStorageProvider().set(STORAGE_KEYS.ONBOARDING_COMPLETE, true);
                // Use SyncManager for safe sync
                setSyncStatus("Syncing...");
                const syncSuccess = await getSyncManager().sync();
                setSyncSuccess(syncSuccess);
                setSyncStatus(syncSuccess ? "Sync complete" : "Sync failed");
                setTimeout(() => setSyncStatus(null), 2000);

                // Reload settings from storage after sync to reflect cloud values
                const storage = getStorageProvider();
                const storedSettings = await storage.getMany<Record<string, boolean>>([
                    "enableChecklist",
                    "enableCustomAssignments"
                ]);
                setSettings({
                    enableChecklist: !!storedSettings.enableChecklist,
                    enableCustomAssignments: !!storedSettings.enableCustomAssignments,
                });

                setAuthState(await getAuthState());
                setSubscription(await getSubscriptionInfo(true));
                setView("main");
            } else {
                setAuthError(res.error || "Authentication failed");
            }
        } catch (err) {
            setAuthError("Connection error");
        } finally {
            setAuthSubmitting(false);
        }
    };

    const handleLogout = async () => {
        await logout();
        setAuthState({ isLoggedIn: false, user: null, token: null });
        setSubscription(null);
    };

    const handleUpgrade = async (plan: "monthly" | "yearly") => {
        setUpgradeSubmitting(plan);
        try {
            const { createCheckoutSession } = await import("../../storage/EntitlementService");
            const dashboardUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
                ? chrome.runtime.getURL('src/ui/options/options.html')
                : window.location.origin + '/options.html';

            const res = await createCheckoutSession(plan, dashboardUrl);
            
            if (res.success && res.checkoutUrl) {
                window.open(res.checkoutUrl, "_blank");
                setView("main");
            } else {
                setAuthError(res.error || "Failed to start checkout");
            }
        } catch (err) {
            setAuthError("Checkout error");
        } finally {
            setUpgradeSubmitting(null);
        }
    };

    const handleSyncNow = async () => {
        setSyncStatus("Syncing...");
        setSyncSuccess(true);
        const syncManager = getSyncManager();
        const success = await syncManager.sync();
        setSyncSuccess(success);

        if (success) {
            setSyncStatus("Sync complete");
        } else {
            const { state, error } = syncManager.getState();

            if (state === "quiet_error") {
                setSyncStatus("Will retry soon...");
                setSyncSuccess(true); // Treat as success/neutral for UI color
            } else if (error?.message === "Subscription Required") {
                setSubscription(await getSubscriptionInfo());
                setView("upgrade");
                setSyncStatus(null);
                return;
            } else {
                setSyncStatus(error?.message || "Sync failed");
            }
        }
        setTimeout(() => setSyncStatus(null), 3000);

        // Reload settings from storage after sync to reflect any changes
        if (success) {
            const storage = getStorageProvider();
            const storedSettings = await storage.getMany<Record<string, boolean>>([
                "enableChecklist",
                "enableCustomAssignments"
            ]);
            setSettings({
                enableChecklist: !!storedSettings.enableChecklist,
                enableCustomAssignments: !!storedSettings.enableCustomAssignments,
            });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 flex flex-col">
            <header className="flex items-center gap-3 mb-6">
                <img src={logo} alt="Veracross Plus" className="w-10 h-10 object-contain shadow-lg shadow-indigo-500/10 rounded-xl" />
                <h1 className="text-xl font-bold tracking-tight text-slate-800">Veracross Plus</h1>
            </header>

            {/* ONBOARDING VIEW */}
            {view === "onboarding" && (
                <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="text-[15px] text-slate-500 mb-5 leading-relaxed font-medium">
                        Welcome! How would you like to keep your data?
                    </p>

                    <button
                        onClick={() => handleOnboardingChoice("local")}
                        className="group bg-white border-2 border-transparent rounded-2xl p-5 mb-3 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl hover:border-slate-100 shadow-lg text-left flex flex-col gap-2.5"
                    >
                        <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-indigo-500 group-hover:bg-indigo-50 transition-colors">
                            <Lock className="w-5.5 h-5.5" />
                        </div>
                        <div>
                            <div className="font-semibold text-[17px] text-slate-800">Local Only</div>
                            <div className="text-sm text-slate-500 leading-relaxed">Store data only on this browser. Private and instant.</div>
                        </div>
                    </button>

                    <button
                        onClick={() => handleOnboardingChoice("cloud")}
                        className="group bg-white border-2 border-transparent rounded-2xl p-5 mb-0 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl hover:border-slate-100 shadow-lg text-left flex flex-col gap-2.5 relative overflow-hidden"
                    >
                        <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-indigo-500 group-hover:bg-indigo-50 transition-colors">
                            <Cloud className="w-5.5 h-5.5" />
                        </div>
                        <div>
                            <div className="font-semibold text-[17px] text-slate-800">Cloud Sync</div>
                            <div className="text-sm text-slate-500 leading-relaxed">Sync settings across all your devices with a secure account.</div>
                        </div>
                    </button>
                </div>
            )}

            {/* AUTH CHOICE VIEW */}
            {view === "auth-choice" && (
                <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button
                        onClick={() => setView("onboarding")}
                        className="flex items-center gap-1.5 text-slate-400 text-sm font-semibold mb-5 hover:text-slate-600 transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </button>
                    <h2 className="text-xl font-bold mb-3 tracking-tight">Cloud Sync</h2>
                    <p className="text-sm text-slate-500 mb-7 leading-relaxed">Do you have a Veracross Plus account already?</p>

                    <button
                        onClick={() => { setAuthMode("login"); setView("auth-form"); }}
                        className="w-full bg-indigo-500 text-white p-3.5 rounded-xl font-semibold shadow-lg shadow-indigo-500/25 hover:bg-indigo-600 hover:-translate-y-0.5 transition-all mb-3.5"
                    >
                        Yes, Sign In
                    </button>
                    <button
                        onClick={() => { setAuthMode("register"); setView("auth-form"); }}
                        className="w-full bg-slate-100 text-slate-700 p-3.5 rounded-xl font-semibold hover:bg-slate-200 transition-colors"
                    >
                        No, I'm New
                    </button>
                </div>
            )}

            {/* AUTH FORM VIEW */}
            {view === "auth-form" && (
                <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button
                        onClick={() => setView("auth-choice")}
                        className="flex items-center gap-1.5 text-slate-400 text-sm font-semibold mb-5 hover:text-slate-600 transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </button>
                    <h2 className="text-xl font-bold mb-6 tracking-tight">{authMode === "login" ? "Sign In" : "Create Account"}</h2>

                    <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="text-[13px] font-semibold text-slate-500 ml-0.5">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@email.com"
                                className="w-full p-3.5 px-4 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[13px] font-semibold text-slate-500 ml-0.5">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full p-3.5 px-4 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all"
                            />
                        </div>
                        <button
                            disabled={authSubmitting}
                            className="w-full bg-indigo-500 text-white p-3.5 rounded-xl font-semibold shadow-lg shadow-indigo-500/25 hover:bg-indigo-600 hover:-translate-y-0.5 disabled:opacity-70 disabled:translate-y-0 transition-all mt-3 flex items-center justify-center gap-2"
                        >
                            {authSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            {authSubmitting ? "Please wait..." : "Continue"}
                        </button>
                        {authError && (
                            <div className="mt-3 p-2.5 bg-red-50 border border-red-100 text-red-500 rounded-lg text-xs font-medium text-center animate-in fade-in zoom-in-95 duration-200">
                                {authError}
                            </div>
                        )}
                    </form>
                </div>
            )}

            {/* MAIN VIEW */}
            {view === "main" && (
                <div className="flex flex-col animate-in fade-in duration-300">
                    {authState.isLoggedIn && authState.user && (
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col gap-3 mb-4 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-3 opacity-[0.03] pointer-events-none">
                                <UserIcon size={48} />
                            </div>
                            <div className="flex items-center justify-between gap-4 relative z-10">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_0_3px_rgba(16,185,129,0.1)] shrink-0"></div>
                                    <span className="text-[14px] font-bold text-slate-700 truncate">{authState.user.email}</span>
                                    {subscription?.isSubscribed ? (
                                        <span className="bg-indigo-50 text-indigo-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border border-indigo-100 uppercase tracking-tight">
                                            {subscription.plan}
                                        </span>
                                    ) : subscription?.isGrandfathered ? (
                                        <span className="bg-emerald-50 text-emerald-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border border-emerald-100 uppercase tracking-tight">
                                            Legacy
                                        </span>
                                    ) : (
                                        <span className="bg-slate-100 text-slate-500 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border border-slate-200 uppercase tracking-tight">
                                            Free
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="text-[11px] font-bold text-slate-400 hover:text-red-500 transition-colors shrink-0 whitespace-nowrap"
                                >
                                    Sign Out
                                </button>
                            </div>

                            <button
                                onClick={() => typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open('options.html')}
                                className="w-full bg-white border border-slate-200 text-slate-700 py-2 rounded-lg text-[12px] font-bold shadow-sm hover:shadow-md hover:border-indigo-200 hover:text-indigo-600 transition-all flex items-center justify-center gap-2 group"
                            >
                                <LayoutDashboard size={14} className="text-slate-400 group-hover:text-indigo-500" />
                                Open Dashboard
                            </button>
                        </div>
                    )}

                    <div className="flex flex-col gap-4">
                        <div className="bg-white rounded-2xl p-4 shadow-lg border border-black/5 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-indigo-500">
                                        <CheckCircle2 size={18} />
                                    </div>
                                    <div className="font-semibold text-sm">Checkboxes</div>
                                </div>
                                <button
                                    onClick={() => handleToggle("enableChecklist")}
                                    className={`w-10 h-5.5 rounded-full relative transition-colors ${settings.enableChecklist ? 'bg-indigo-500' : 'bg-slate-200'}`}
                                >
                                    <div className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full transition-transform ${settings.enableChecklist ? 'left-5' : 'left-0.5'} shadow-sm`} />
                                </button>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl p-4 shadow-lg border border-black/5 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-indigo-500">
                                        <Plus size={18} />
                                    </div>
                                    <div className="font-semibold text-sm">Custom Tasks</div>
                                </div>
                                <button
                                    onClick={() => handleToggle("enableCustomAssignments")}
                                    className={`w-10 h-5.5 rounded-full relative transition-colors ${settings.enableCustomAssignments ? 'bg-indigo-500' : 'bg-slate-200'}`}
                                >
                                    <div className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full transition-transform ${settings.enableCustomAssignments ? 'left-5' : 'left-0.5'} shadow-sm`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {authState.isLoggedIn ? (
                        <div className="mt-6 flex flex-col gap-3">
                            <button
                                onClick={handleSyncNow}
                                className="w-full bg-slate-100 text-slate-700 p-3.5 rounded-xl font-semibold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                            >
                                <RefreshCw className={`w-4 h-4 ${syncStatus === "Syncing..." ? 'animate-spin' : ''}`} />
                                Sync Now
                            </button>
                            {syncStatus && (
                                <div className={`text-[13px] font-bold text-center animate-in fade-in duration-300 ${syncSuccess ? 'text-indigo-500' : 'text-slate-400'}`}>
                                    {syncStatus}
                                </div>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => setView("auth-choice")}
                            className="mt-6 p-5 bg-indigo-50 border border-indigo-100 rounded-2xl flex flex-col items-center gap-3 text-center group hover:bg-indigo-100 transition-colors"
                        >
                            <p className="text-[13px] text-indigo-600 font-bold leading-relaxed flex items-center gap-2">
                                <Cloud className="w-4 h-4" />
                                Enable Cloud Sync
                            </p>
                            <p className="text-xs text-indigo-400 font-medium">Keep your settings safe and synced across devices.</p>
                        </button>
                    )}
                </div>
            )}

            {/* UPGRADE VIEW */}
            {view === "upgrade" && (
                <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button
                        onClick={() => setView("main")}
                        className="flex items-center gap-1.5 text-slate-400 text-sm font-semibold mb-5 hover:text-slate-600 transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </button>

                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <Cloud className="w-8 h-8" />
                        </div>
                        <h2 className="text-xl font-bold tracking-tight text-slate-800 mb-2">Veracross Plus Cloud</h2>
                        <p className="text-sm text-slate-500 leading-relaxed max-w-[280px] mx-auto">
                            Custom assignments and device sync are part of Veracross Plus Cloud.
                        </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-6">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 text-center">
                                <div className="text-xl font-bold text-slate-800">$2.99</div>
                                <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Monthly</div>
                            </div>
                            <div className="w-px h-10 bg-slate-200"></div>
                            <div className="flex-1 text-center">
                                <div className="text-xl font-bold text-slate-800">$24.99</div>
                                <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Yearly</div>
                                <div className="text-[10px] text-emerald-500 font-extrabold">SAVE 30%</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={() => handleUpgrade("yearly")}
                            disabled={!!upgradeSubmitting}
                            className="w-full bg-indigo-500 text-white p-4 rounded-xl font-bold shadow-lg shadow-indigo-500/25 hover:bg-indigo-600 hover:-translate-y-0.5 disabled:opacity-70 disabled:translate-y-0 transition-all flex items-center justify-center gap-2"
                        >
                            {upgradeSubmitting === "yearly" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                            Enable Cloud Features — Yearly
                        </button>
                        <button
                            onClick={() => handleUpgrade("monthly")}
                            disabled={!!upgradeSubmitting}
                            className="w-full bg-white text-indigo-600 border-2 border-indigo-50 p-3.5 rounded-xl font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                        >
                            {upgradeSubmitting === "monthly" && <Loader2 className="w-4 h-4 animate-spin" />}
                            Enable Cloud Features — Monthly
                        </button>
                        <button
                            onClick={() => setView("main")}
                            className="text-sm font-semibold text-slate-400 hover:text-slate-600 transition-colors py-2"
                        >
                            Keep using local mode
                        </button>
                    </div>

                    <p className="mt-4 text-[11px] text-slate-400 text-center leading-relaxed">
                        You can keep using all existing assignments for free.
                    </p>
                </div>
            )}

            <footer className="mt-auto pt-6 text-center text-xs text-slate-400 font-medium tracking-wide">
                Veracross Plus &bull; {typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : "Dev"}
            </footer>
        </div>
    );
};

export default Popup;
