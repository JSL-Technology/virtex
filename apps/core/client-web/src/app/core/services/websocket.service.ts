// app/core/services/websocket.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs'; // Importa Subject
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService implements OnDestroy {
  private socket: Socket | null = null;
  // Subject para notificar cuando la conexión está establecida
  private connectionReady = new Subject<void>();
  public connectionReady$ = this.connectionReady.asObservable();

  constructor() {}

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const baseUrl = environment.apiUrl.split('/api')[0];
    console.log('Attempting to connect WebSocket...');
    this.socket = io(baseUrl, {
      withCredentials: true,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected successfully!', this.socket?.id);
      // Notificar a los suscriptores que la conexión está lista
      this.connectionReady.next();
    });

    this.socket.on('disconnect', (reason) => console.log('WebSocket disconnected:', reason));
    this.socket.on('connect_error', (err) => console.error('WebSocket connection error:', err.message));
  }

  disconnect(): void {
    if (this.socket) {
      console.log('Disconnecting WebSocket...');
      this.socket.disconnect();
      this.socket = null;
    }
  }

  listen<T>(eventName: string): Observable<T> {
    return new Observable(observer => {
      if (!this.socket) {
        // En lugar de fallar silenciosamente, podrías lanzar un error o encolar el listener.
        // Por ahora, lo mantenemos simple.
        return;
      }
      this.socket.on(eventName, (data: T) => {
        observer.next(data);
      });

      return () => {
        this.socket?.off(eventName);
      };
    });
  }

  emit(eventName: string, data: any): void {
    if (this.socket) {
      this.socket.emit(eventName, data);
    }
  }

  ngOnDestroy() {
    this.disconnect();
  }
}