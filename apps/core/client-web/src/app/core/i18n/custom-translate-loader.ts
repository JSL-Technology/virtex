import { TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import * as en from '../../../assets/i18n/en.json';
import * as es from '../../../assets/i18n/es.json';

export class CustomTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    // Return the directly imported JSON based on the language
    return of(lang === 'es' ? es : en);
  }
}
