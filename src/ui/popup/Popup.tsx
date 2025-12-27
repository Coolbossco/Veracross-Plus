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
    ShieldCheck,
    User as UserIcon,
    Loader2
} from "lucide-react";
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


type View = "onboarding" | "auth-choice" | "auth-form" | "main";

const Popup: React.FC = () => {
    const [view, setView] = useState<View>("main");
    const [loading, setLoading] = useState(true);
    const [authState, setAuthState] = useState<AuthState>({ isLoggedIn: false, user: null, token: null });
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [authSubmitting, setAuthSubmitting] = useState(false);
    const [syncStatus, setSyncStatus] = useState<string | null>(null);
    const [syncSuccess, setSyncSuccess] = useState(true);
    const [settings, setSettings] = useState({
        enableChecklist: false,
        enableCustomAssignments: false,
    });

    useEffect(() => {
        const init = async () => {
            await initializeFeatureFlags();

            // Initialize auto-sync controller for event-driven syncing
            initializeAutoSync();

            const storage = getStorageProvider();
            const isOnboardingComplete = await storage.get<boolean>(STORAGE_KEYS.ONBOARDING_COMPLETE);

            if (!isOnboardingComplete) {
                setView("onboarding");
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
                setView("main");
            }
            setLoading(false);
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
    };

    const handleSyncNow = async () => {
        setSyncStatus("Syncing...");
        setSyncSuccess(true);
        const success = await getSyncManager().sync();
        setSyncSuccess(success);
        setSyncStatus(success ? "Sync complete" : "Sync failed");
        setTimeout(() => setSyncStatus(null), 2000);

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
            <div className="flex items-center justify-center min-h-[480px]">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 flex flex-col min-h-[480px]">
            <header className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-linear-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
                    <Layers className="w-6 h-6" />
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-800">Veracross Plus</h1>
            </header>

            {/* ONBOARDING VIEW */}
            {view === "onboarding" && (
                <div className="flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="text-[15px] text-slate-500 mb-6 leading-relaxed font-medium">
                        Welcome! How would you like to keep your data?
                    </p>

                    <button
                        onClick={() => handleOnboardingChoice("local")}
                        className="group bg-white border-2 border-transparent rounded-2xl p-6 mb-4 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl hover:border-slate-100 shadow-lg text-left flex flex-col gap-2.5"
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
                        className="group bg-white border-2 border-transparent rounded-2xl p-6 mb-4 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-xl hover:border-slate-100 shadow-lg text-left flex flex-col gap-2.5"
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
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 flex items-center justify-between mb-6 shadow-sm">
                            <div className="flex items-center gap-2.5">
                                <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_0_3px_rgba(16,185,129,0.1)]"></div>
                                <span className="text-[13px] font-bold text-slate-700 truncate max-w-[160px]">{authState.user.email}</span>
                            </div>
                            <button onClick={handleLogout} className="text-[13px] font-semibold text-slate-400 hover:text-red-400 transition-colors">
                                Sign Out
                            </button>
                        </div>
                    )}

                    <div className="flex flex-col gap-4">
                        <div className="bg-white rounded-2xl p-5 shadow-lg border border-black/5 flex flex-col gap-3.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-indigo-500">
                                        <CheckCircle2 className="w-5 h-5" />
                                    </div>
                                    <div className="font-semibold text-sm">Checkboxes</div>
                                </div>
                                <button
                                    onClick={() => handleToggle("enableChecklist")}
                                    className={`w-12 h-6.5 rounded-full relative transition-colors ${settings.enableChecklist ? 'bg-indigo-500' : 'bg-slate-200'}`}
                                >
                                    <div className={`absolute top-1 w-4.5 h-4.5 bg-white rounded-full transition-transform ${settings.enableChecklist ? 'left-6.5' : 'left-1'} shadow-sm`} />
                                </button>
                            </div>
                            <p className="text-[13px] text-slate-500 leading-relaxed">Enable interactive checkboxes for assignments.</p>
                        </div>

                        <div className="bg-white rounded-2xl p-5 shadow-lg border border-black/5 flex flex-col gap-3.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-indigo-500">
                                        <Plus className="w-5 h-5" />
                                    </div>
                                    <div className="font-semibold text-sm">Custom Tasks</div>
                                </div>
                                <button
                                    onClick={() => handleToggle("enableCustomAssignments")}
                                    className={`w-12 h-6.5 rounded-full relative transition-colors ${settings.enableCustomAssignments ? 'bg-indigo-500' : 'bg-slate-200'}`}
                                >
                                    <div className={`absolute top-1 w-4.5 h-4.5 bg-white rounded-full transition-transform ${settings.enableCustomAssignments ? 'left-6.5' : 'left-1'} shadow-sm`} />
                                </button>
                            </div>
                            <p className="text-[13px] text-slate-500 leading-relaxed">Add your own assignments to the timeline.</p>
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
                                <div className={`text-[13px] font-bold text-center animate-in fade-in duration-300 ${syncSuccess ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {syncStatus}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="mt-6 p-5 bg-red-50 border border-red-100 rounded-2xl flex flex-col items-center gap-3 text-center">
                            <p className="text-[13px] text-red-700 font-medium leading-relaxed">Cloud sync is currently inactive.</p>
                            <button
                                onClick={() => setView("auth-choice")}
                                className="w-full bg-red-500 text-white p-2.5 rounded-xl text-[13px] font-bold hover:bg-red-600 shadow-md shadow-red-500/20 transition-all"
                            >
                                Enable Sync
                            </button>
                        </div>
                    )}
                </div>
            )}

            <footer className="mt-auto pt-6 text-center text-xs text-slate-400 font-medium tracking-wide">
                Veracross Plus &bull; 0.2.1
            </footer>
        </div>
    );
};

export default Popup;
