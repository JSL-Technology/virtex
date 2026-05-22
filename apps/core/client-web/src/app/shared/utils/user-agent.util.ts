export function parseUserAgent(ua: string): string {
    if (ua.includes('Windows')) return 'Windows PC';
    if (ua.includes('Mac')) return 'Mac';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone')) return 'iPhone';
    return 'Dispositivo Desconocido';
}
