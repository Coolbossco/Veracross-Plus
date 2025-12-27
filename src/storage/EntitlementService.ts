/**
 * Veracross Plus — Entitlement Service
 *
 * Manages subscription and entitlement state for the extension.
 * Handles caching, grace periods, and grandfathering logic.
 *
 * @version 1
 */

import { getAuthToken, getAuthState } from "./AuthService";
import { API_BASE_URL } from "../constants";

// Storage keys for entitlement state
const ENTITLEMENT_STORAGE_KEYS = {
    STATE: "vcp_entitlement_state",
    LAST_VERIFIED: "vcp_entitlement_last_verified",
} as const;

const QUALIFICATION_DEADLINE = new Date("2026-01-01T00:00:00Z");
const BENEFIT_EXPIRY = new Date("2026-03-01T00:00:00Z");

/**
 * Subscription status from backend
 */
export interface SubscriptionInfo {
    isSubscribed: boolean;
    plan: "monthly" | "yearly" | null;
    subscriptionEnd: string | null;
    cancelAtPeriodEnd: boolean;
}

/**
 * Entitlement status
 */
export interface EntitlementInfo {
    canCreateAssignments: boolean;
    isGrandfathered: boolean;
    grandfatherCutoff: string;
}

/**
 * Cache information for offline support
 */
export interface CacheInfo {
    lastVerified: string;
    gracePeriodEnd: string;
    gracePeriodDays: number;
}

/**
 * Full entitlement state (matches backend response)
 */
export interface EntitlementState {
    subscription: SubscriptionInfo;
    entitlement: EntitlementInfo;
    cache: CacheInfo;
}

/**
 * Reasons why assignment creation may be allowed or blocked
 */
export type EntitlementReason =
    | "subscribed"
    | "grandfathered"
    | "grace_period"
    | "free_tier"
    | "offline_expired";

/**
 * Result of checking if user can create assignments
 */
export interface CanCreateResult {
    allowed: boolean;
    reason: EntitlementReason;
    message?: string;
}

// Default grace period in days (fallback if not from server)
const DEFAULT_GRACE_PERIOD_DAYS = 7;

/**
 * Get cached entitlement state from storage
 */
async function getCachedState(): Promise<EntitlementState | null> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve(null);
            return;
        }
        chrome.storage.local.get(ENTITLEMENT_STORAGE_KEYS.STATE, (result) => {
            const state = result[ENTITLEMENT_STORAGE_KEYS.STATE] as EntitlementState | undefined;
            resolve(state || null);
        });
    });
}

/**
 * Store entitlement state in cache
 */
async function setCachedState(state: EntitlementState): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve();
            return;
        }
        chrome.storage.local.set(
            { [ENTITLEMENT_STORAGE_KEYS.STATE]: state },
            resolve
        );
    });
}

/**
 * Clear cached entitlement state
 */
export async function clearEntitlementCache(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve();
            return;
        }
        chrome.storage.local.remove(
            [ENTITLEMENT_STORAGE_KEYS.STATE, ENTITLEMENT_STORAGE_KEYS.LAST_VERIFIED],
            resolve
        );
    });
}

/**
 * Fetch fresh entitlement state from backend
 */
async function fetchEntitlementState(): Promise<EntitlementState | null> {
    const token = await getAuthToken();

    if (!token) {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/subscription/status`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            console.warn("[Veracross Plus] Failed to fetch entitlement state:", response.status);
            return null;
        }

        const data = await response.json();
        return data as EntitlementState;
    } catch (error) {
        console.warn("[Veracross Plus] Network error fetching entitlement:", error);
        return null;
    }
}

/**
 * Get current entitlement state
 *
 * Attempts to fetch fresh state from backend, falls back to cache if offline.
 * Cache is refreshed on successful fetch.
 *
 * @param forceRefresh - If true, always try to fetch from backend first
 */
export async function getEntitlementState(forceRefresh = false): Promise<EntitlementState | null> {
    const authState = await getAuthState();

    // Not logged in = no entitlements to check
    if (!authState.isLoggedIn) {
        return null;
    }

    const cachedState = await getCachedState();

    // Check if cache is still fresh (within reasonable time)
    let shouldRefresh = forceRefresh;
    if (!shouldRefresh && cachedState) {
        const lastVerified = new Date(cachedState.cache.lastVerified);
        const now = new Date();
        const hoursSinceVerification = (now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60);
        // Refresh if more than 1 hour since last verification
        shouldRefresh = hoursSinceVerification > 1;
    } else if (!cachedState) {
        shouldRefresh = true;
    }

    if (shouldRefresh) {
        const freshState = await fetchEntitlementState();
        if (freshState) {
            await setCachedState(freshState);
            return freshState;
        }
    }

    return cachedState;
}

/**
 * Check if user is within grace period
 */
function isWithinGracePeriod(state: EntitlementState | null): boolean {
    if (!state) return false;

    const now = new Date();
    const gracePeriodEnd = new Date(state.cache.gracePeriodEnd);

    return now < gracePeriodEnd;
}

/**
 * Check if user can create custom assignments
 *
 * This is the main entitlement check used throughout the extension.
 * Implements the following priority:
 * 1. Active subscription → allowed
 * 2. Grandfathered user (before cutoff) → allowed
 * 3. Within grace period (offline) → allowed
 * 4. Otherwise → blocked (free tier)
 */
export async function canCreateCustomAssignment(): Promise<CanCreateResult> {
    const authState = await getAuthState();

    // Not logged in = local mode only, no cloud features
    if (!authState.isLoggedIn) {
        const now = new Date();
        const isWithinWindow = now < QUALIFICATION_DEADLINE;

        return {
            allowed: false,
            reason: "free_tier",
            message: isWithinWindow
                ? "Sign up before Jan 1st to get custom assignments for free until March!"
                : "Sign in to create custom assignments with cloud sync.",
        };
    }

    const state = await getEntitlementState();

    // No state available (offline, never synced)
    if (!state) {
        // Check if we have any cached state that might still be valid
        const cachedState = await getCachedState();

        if (cachedState && isWithinGracePeriod(cachedState)) {
            // Trust cached subscription status during grace period
            if (cachedState.subscription.isSubscribed) {
                return {
                    allowed: true,
                    reason: "grace_period",
                };
            }
            if (cachedState.entitlement.isGrandfathered) {
                return {
                    allowed: true,
                    reason: "grandfathered",
                };
            }
        }

        return {
            allowed: false,
            reason: "offline_expired",
            message: "Unable to verify subscription. Please check your connection.",
        };
    }

    // Check subscription status
    if (state.subscription.isSubscribed) {
        return {
            allowed: true,
            reason: "subscribed",
        };
    }

    // Check grandfathering
    if (state.entitlement.isGrandfathered) {
        const now = new Date();
        const cutoff = new Date(state.entitlement.grandfatherCutoff);

        if (now < cutoff) {
            return {
                allowed: true,
                reason: "grandfathered",
            };
        }
    }

    // Check grace period for cached data
    if (isWithinGracePeriod(state) && state.entitlement.canCreateAssignments) {
        return {
            allowed: true,
            reason: "grace_period",
        };
    }

    // Free tier - blocked
    return {
        allowed: false,
        reason: "free_tier",
        message: "Custom assignments are part of Veracross Plus Cloud.",
    };
}

/**
 * Check if the user is allowed to use Cloud Sync features
 * (Requires active subscription - Grandfathering does NOT include sync)
 */
export async function canSync(): Promise<boolean> {
    const authState = await getAuthState();
    if (!authState.isLoggedIn) return false;

    // Strict subscription check for sync
    const state = await getEntitlementState();
    return state?.subscription.isSubscribed || false;
}

/**
 * Get subscription info for display purposes
 */
export async function getSubscriptionInfo(): Promise<SubscriptionInfo | null> {
    const state = await getEntitlementState();
    return state?.subscription || null;
}

/**
 * Check if user is grandfathered
 */
export async function isGrandfathered(): Promise<boolean> {
    const state = await getEntitlementState();
    return state?.entitlement.isGrandfathered || false;
}

/**
 * Create a Stripe checkout session
 *
 * Returns the checkout URL to redirect the user to.
 */
export async function createCheckoutSession(
    plan: "monthly" | "yearly"
): Promise<{ success: boolean; checkoutUrl?: string; error?: string }> {
    const token = await getAuthToken();

    if (!token) {
        return { success: false, error: "Not logged in" };
    }

    try {
        const response = await fetch(`${API_BASE_URL}/subscription/checkout`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ plan }),
        });

        if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || "Failed to create checkout" };
        }

        const data = await response.json();
        return { success: true, checkoutUrl: data.checkoutUrl };
    } catch (error) {
        console.error("[Veracross Plus] Checkout error:", error);
        return { success: false, error: "Network error. Please try again." };
    }
}

/**
 * Create a Stripe customer portal session
 *
 * Returns the portal URL for managing subscription.
 */
export async function createPortalSession(): Promise<{
    success: boolean;
    portalUrl?: string;
    error?: string;
}> {
    const token = await getAuthToken();

    if (!token) {
        return { success: false, error: "Not logged in" };
    }

    try {
        const response = await fetch(`${API_BASE_URL}/subscription/portal`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || "Failed to create portal session" };
        }

        const data = await response.json();
        return { success: true, portalUrl: data.portalUrl };
    } catch (error) {
        console.error("[Veracross Plus] Portal error:", error);
        return { success: false, error: "Network error. Please try again." };
    }
}

/**
 * Force refresh of entitlement state from backend
 */
export async function refreshEntitlementState(): Promise<boolean> {
    const state = await getEntitlementState(true);
    return state !== null;
}
