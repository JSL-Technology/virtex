/**
 * Accessibility behaviour both browser applications share.
 *
 * A library and not a folder in the web client for the reason `shared/ui-i18n` gives: the POS
 * terminal is a separate Angular application with its own bundle, so anything living under
 * `apps/core/client-web` reaches none of it. Its sign-in form is a form like any other, and its
 * users are as entitled to know which field was refused.
 *
 * Everything here is application-agnostic: it injects the platform and Angular's own form
 * primitives, and nothing else.
 */
export * from './lib/invalid-field.directive';
