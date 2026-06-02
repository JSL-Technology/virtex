// Shared password policy — single source of truth for all DTOs (register, reset, change).
// Frontend must mirror these rules in password.validator.ts.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

// Uppercase + lowercase + (digit OR non-word character).
// Equivalent to NIST SP 800-63B / OWASP Authentication Cheat Sheet.
export const PASSWORD_POLICY_REGEX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*(?:\d|\W)).+$/;
export const PASSWORD_POLICY_MESSAGE =
  'La contraseña debe contener al menos una mayúscula, una minúscula y un número o símbolo.';
