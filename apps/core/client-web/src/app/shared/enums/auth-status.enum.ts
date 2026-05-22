export enum AuthStatus {
    /**
     * El estado de autenticación se está verificando (por ejemplo, al cargar la aplicación).
     */
    pending = 'pending',

    /**
     * El usuario está autenticado.
     */
    authenticated = 'authenticated',

    /**
     * El usuario no está autenticado.
     */
    unauthenticated = 'unauthenticated',
}