import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * One item of «Mi trabajo»: a catalogue key and its parameters, not an English sentence built on
 * the server (it used to be «Approve VENDOR_BILL #1a2b3c4d» in a Spanish interface).
 */
export interface WorkItem {
  id: string;
  titleKey: string;
  titleParams: { number?: string | null; party?: string | null; amount?: number | null; currency?: string | null };
  dueDate: string | null;
  status: string;
  /** Client route without the company prefix. */
  route: string | null;
}

export interface MyWorkData {
  tasks: WorkItem[];
  approvals: WorkItem[];
  notifications: WorkItem[];
}

@Injectable({
  providedIn: 'root'
})
export class MyWorkService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/my-work`;

  getWorkItems(): Observable<MyWorkData> {
    return this.http.get<MyWorkData>(this.apiUrl);
  }
}
