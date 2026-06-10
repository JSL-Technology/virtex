import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export enum TabEvent {
  RECORD_SAVED = 'RECORD_SAVED',
  RECORD_DELETED = 'RECORD_DELETED',
  RECORD_OPENED = 'RECORD_OPENED',
  FILTER_CHANGED = 'FILTER_CHANGED',
}

export interface TabBusEvent {
  type: TabEvent;
  entity: string;
  id?: string;
  payload?: any;
}

@Injectable({
  providedIn: 'root',
})
export class TabEventBusService {
  private bus$ = new Subject<TabBusEvent>();

  emit(event: TabBusEvent): void {
    this.bus$.next(event);
  }

  on(type: TabEvent, entity?: string): Observable<TabBusEvent> {
    return this.bus$.asObservable().pipe(
      filter(event => event.type === type && (!entity || event.entity === entity))
    );
  }
}
