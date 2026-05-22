export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string; // This can be a translation key or a plain string
  duration?: number; // Duration in milliseconds
}
