import type { ConfirmPolicy } from "../types";

export type WriteDecision = "allow" | "confirm" | "deny";

export interface ConfirmPolicyState {
  policy: ConfirmPolicy;
  /** session 策略下，本会话是否已授权自动应用 */
  sessionTrusted: boolean;
}

export function createConfirmPolicyState(
  policy: ConfirmPolicy = "always",
): ConfirmPolicyState {
  return {
    policy,
    sessionTrusted: false,
  };
}

export function decideWrite(
  state: ConfirmPolicyState,
): WriteDecision {
  switch (state.policy) {
    case "auto":
      return "allow";
    case "session":
      return state.sessionTrusted ? "allow" : "confirm";
    case "always":
      return "confirm";
  }
}

export function trustSession(state: ConfirmPolicyState): ConfirmPolicyState {
  return {
    ...state,
    sessionTrusted: true,
  };
}

export function revokeSessionTrust(
  state: ConfirmPolicyState,
): ConfirmPolicyState {
  return {
    ...state,
    sessionTrusted: false,
  };
}
