import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
}

@Injectable({
  providedIn: 'root',
})
export class CurrenciesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/currencies`;

  getCurrencies(): Observable<Currency[]> {
    return this.http.get<Currency[]>(this.apiUrl);
  }
}
