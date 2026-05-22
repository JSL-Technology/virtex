import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { Industry, CompanySize } from '@virteex/shared/types';
// import { environment } from '../../../../environments/environment';
import { environment } from '../../../environments/environment';

export interface RegistrationOptions {
  industries: Industry[];
  companySizes: CompanySize[];
}

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private apiUrl = environment.apiUrl;
  private registrationOptions$: Observable<RegistrationOptions> | null = null;

  constructor(private http: HttpClient) {}

  getRegistrationOptions(): Observable<RegistrationOptions> {
    if (!this.registrationOptions$) {
      this.registrationOptions$ = this.http.get<RegistrationOptions>(`${this.apiUrl}/config/registration-options`).pipe(
        shareReplay(1)
      );
    }
    return this.registrationOptions$;
  }
}
