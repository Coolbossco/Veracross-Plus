/**
 * Pure rollout decision. Page theme and toolbar popup must follow `enabled`.
 *
 * A stored enabled=true is a grant. Transient failures and a missed or
 * mismatched username lookup must not clear it. An explicit Worker denial
 * (not_allowlisted / unpublished) for the granted user does.
 */

/** @typedef {{ enabled: boolean, version?: string, user?: string, reason?: string, confirmed?: boolean }} StoredRollout */

/**
 * @typedef {{ type: "missing_user", reason?: string }
 *   | { type: "transport", reason: string }
 *   | { type: "http", reason: string }
 *   | { type: "body", enabled: boolean, reason: string }} RolloutOutcome
 */

/**
 * @typedef {{ enabled: boolean, reason: string, authoritative: boolean, rememberUser: string }} RolloutDecision
 */

const EXPLICIT_OFF = new Set(["not_allowlisted", "unpublished"]);

/**
 * @param {StoredRollout | null | undefined} stored
 * @returns {boolean}
 */
export function isStickyGrant(stored) {
  return stored?.enabled === true;
}

/**
 * @param {{ user: string, stored: StoredRollout | null | undefined, outcome: RolloutOutcome }} input
 * @returns {RolloutDecision}
 */
export function decideRollout({ user, stored, outcome }) {
  const sticky = isStickyGrant(stored);
  const grantedUser = typeof stored?.user === "string" ? stored.user : "";
  const queried = typeof user === "string" ? user : "";

  if (
    outcome.type === "missing_user" ||
    outcome.type === "transport" ||
    outcome.type === "http"
  ) {
    return {
      enabled: sticky,
      reason: outcome.reason || outcome.type,
      authoritative: false,
      rememberUser: grantedUser,
    };
  }

  if (outcome.enabled === true) {
    return {
      enabled: true,
      reason: outcome.reason || "ok",
      authoritative: true,
      rememberUser: queried || grantedUser,
    };
  }

  const explicit = EXPLICIT_OFF.has(outcome.reason) && queried !== "";
  if (explicit) {
    // A different local-part than the one we already granted is a bad lookup,
    // not proof this student was removed.
    if (sticky && grantedUser && queried !== grantedUser) {
      return {
        enabled: true,
        reason: "lookup_mismatch",
        authoritative: false,
        rememberUser: grantedUser,
      };
    }
    return {
      enabled: false,
      reason: outcome.reason,
      authoritative: true,
      rememberUser: grantedUser || queried,
    };
  }

  return {
    enabled: sticky,
    reason: outcome.reason || (sticky ? "sticky" : "disabled"),
    authoritative: false,
    rememberUser: grantedUser,
  };
}
