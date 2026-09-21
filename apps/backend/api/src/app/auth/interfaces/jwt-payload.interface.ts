

export interface JwtPayload {
    id: string;
    email: string;
    organizationId: string;
    roles: string[];
    permissions?: string[];
    tokenVersion?: number;
    sessionId?: string;

    isImpersonating?: boolean;
    originalUserId?: string;

    /**
     * The session is held until this member enrols a second factor their organization requires.
     *
     * Stamped at sign-in by `AuthService.login` and enforced by `MfaEnrolmentGuard`, which refuses
     * every route that is not on the enrolment path. It lives in the token rather than being
     * re-derived per request so that the decision is made once, with the account state that was
     * true when the session began, and cannot flip mid-session because a cache entry expired.
     */
    mfaEnrolmentRequired?: boolean;
}