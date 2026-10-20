export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
  // The point-of-sale application: its own dev server (`npm run dev:pos`).
  posUrl: 'http://localhost:4300',
  vapidPublicKey: 'YOUR_VAPID_PUBLIC_KEY',
  
  // Nueva configuración para reCAPTCHA
  recaptcha: {
    siteKey: '6LeG8p4rAAAAAGpAeRZ-MAFR_mHthbHb5ydkTEuR' // <-- Pega la clave aquí

  },

  // Clave para la Maps Embed API de Google (el mapa de "Sesiones activas").
  // Habilita "Maps Embed API" en Google Cloud y pega aquí la clave. Vacío = no se muestra el mapa.
  googleMapsApiKey: 'AIzaSyCnQTeYxlPXfOnczBg683_2XGZaGexJ6yQ'
};