/**
 * Veracross Plus — Auth Service
 *
 * Handles authentication state and API communication for accounts.
 * Stores auth token and provides login/logout functionality.
 *
 * @version 1
 */

// Configuration - can be overridden via storage
import { API_BASE_URL } from "../constants";

// Storage keys for auth
const AUTH_STORAGE_KEYS = {
    TOKEN: "vcp_auth_token",
    USER: "vcp_user",
    IS_LOGGED_IN: "vcp_is_logged_in",
} as const;

export interface User {
    id: string;
    email: string;
}

export interface AuthState {
    isLoggedIn: boolean;
    user: User | null;
    token: string | null;
}

/**
 * Get stored auth token
 */
export async function getAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve(null);
            return;
        }
        chrome.storage.local.get(AUTH_STORAGE_KEYS.TOKEN, (result) => {
            resolve((result[AUTH_STORAGE_KEYS.TOKEN] as string) || null);
        });
    });
}

/**
 * Get current auth state
 */
export async function getAuthState(): Promise<AuthState> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve({ isLoggedIn: false, user: null, token: null });
            return;
        }
        chrome.storage.local.get(
            [AUTH_STORAGE_KEYS.TOKEN, AUTH_STORAGE_KEYS.USER, AUTH_STORAGE_KEYS.IS_LOGGED_IN],
            (result) => {
                resolve({
                    isLoggedIn: (result[AUTH_STORAGE_KEYS.IS_LOGGED_IN] as boolean) || false,
                    user: (result[AUTH_STORAGE_KEYS.USER] as User) || null,
                    token: (result[AUTH_STORAGE_KEYS.TOKEN] as string) || null,
                });
            }
        );
    });
}

/**
 * Store auth credentials
 */
async function storeAuthCredentials(token: string, user: User): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve();
            return;
        }
        chrome.storage.local.set(
            {
                [AUTH_STORAGE_KEYS.TOKEN]: token,
                [AUTH_STORAGE_KEYS.USER]: user,
                [AUTH_STORAGE_KEYS.IS_LOGGED_IN]: true,
            },
            resolve
        );
    });
}

/**
 * Clear auth credentials
 */
async function clearAuthCredentials(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
            resolve();
            return;
        }
        chrome.storage.local.remove(
            [AUTH_STORAGE_KEYS.TOKEN, AUTH_STORAGE_KEYS.USER, AUTH_STORAGE_KEYS.IS_LOGGED_IN],
            resolve
        );
    });
}

/**
 * Register a new account
 */
export async function register(
    email: string,
    password: string
): Promise<{ success: boolean; error?: string; user?: User }> {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || "Registration failed" };
        }

        await storeAuthCredentials(data.token, data.user);
        return { success: true, user: data.user };
    } catch (error) {
        console.error("[Veracross Plus] Registration error:", error);
        return { success: false, error: "Network error. Please try again." };
    }
}

/**
 * Login to existing account
 */
export async function login(
    email: string,
    password: string
): Promise<{ success: boolean; error?: string; user?: User }> {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || "Login failed" };
        }

        await storeAuthCredentials(data.token, data.user);
        return { success: true, user: data.user };
    } catch (error) {
        console.error("[Veracross Plus] Login error:", error);
        return { success: false, error: "Network error. Please try again." };
    }
}

/**
 * Logout and clear credentials
 */
export async function logout(): Promise<void> {
    await clearAuthCredentials();
}

/**
 * Handle authentication-related errors from the backend.
 * Specifically checks for 404 "User not found" and triggers a logout.
 * 
 * @param response The fetch Response object
 * @returns true if the error was handled (user logged out), false otherwise
 */
export async function handleAuthError(response: Response): Promise<boolean> {
    if (response.status === 404) {
        try {
            // Clone the response so it can be read again by the caller if needed
            const clonedResponse = response.clone();
            const data = await clonedResponse.json();

            if (data.error === "User not found") {
                console.warn("[Veracross Plus] User not found on backend. Logging out...");
                await logout();
                return true;
            }
        } catch (e) {
            // Not JSON or other parsing error, ignore
        }
    }

    if (response.status === 401) {
        // Optional: Could also trigger logout on 401 if we want strict session handling
        // But for now, we'll focus on the specific 404 "User not found" request.
    }

    return false;
}

/**
 * Check if user is currently logged in
 */
export async function isLoggedIn(): Promise<boolean> {
    const state = await getAuthState();
    return state.isLoggedIn && !!state.token;
}
