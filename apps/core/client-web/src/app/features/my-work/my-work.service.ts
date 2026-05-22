import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
// import { environment } from '../environments/environment';

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  status: string;
  link: string;
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
    return this.http.get<MyWorkData>(this.apiUrl, { withCredentials: true });
  }
}
