import { Injectable, signal, computed } from '@angular/core';

interface LoaderState {
  isActive: boolean;
  startTime: number;
}

@Injectable({
  providedIn: 'root'
})
export class LoaderService {
  private _loaders = signal<Map<string, LoaderState>>(new Map());

  // Helper to get active state for a specific ID
  public isLoading(id: string) {
    return computed(() => this._loaders().get(id)?.isActive || false);
  }

  public show(id: string): void {
    const currentState = this._loaders().get(id);
    if (currentState?.isActive) return;

    this._loaders.update(map => {
      const newMap = new Map(map);
      newMap.set(id, { isActive: true, startTime: Date.now() });
      return newMap;
    });
  }

  public hide(id: string): void {
    const state = this._loaders().get(id);
    if (!state || !state.isActive) return;

    const elapsed = Date.now() - state.startTime;
    const minDuration = 2000; // 2 seconds minimum

    if (elapsed < minDuration) {
      setTimeout(() => {
        this._removeLoader(id);
      }, minDuration - elapsed);
    } else {
      this._removeLoader(id);
    }
  }

  private _removeLoader(id: string): void {
    this._loaders.update(map => {
      const newMap = new Map(map);
      newMap.set(id, { isActive: false, startTime: 0 });
      return newMap;
    });
  }
}
