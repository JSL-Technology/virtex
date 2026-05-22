import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { Currency } from './entities/currency.entity';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly xeApiBaseUrl = 'https://xecdapi.xe.com/v1';

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    @InjectRepository(Currency)
    private readonly currencyRepository: Repository<Currency>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron() {
    this.logger.log('Iniciando tarea programada: Actualización de tasas de cambio desde Xe.');
    await this.updateRates();
  }

  async updateRates(): Promise<{ message: string; rates_updated: number }> {
    const apiKey = this.configService.get<string>('XE_API_KEY');
    const apiId = this.configService.get<string>('XE_API_ID');

    if (!apiKey || !apiId) {
      this.logger.error('Las credenciales de la API de Xe (XE_API_ID, XE_API_KEY) no están configuradas.');
      throw new Error('Credenciales de API no configuradas.');
    }

    const baseCurrency = this.configService.get<string>('BASE_CURRENCY', 'USD');
    const currencies = await this.currencyRepository.find();
    const currencyCodes = currencies.map(c => c.code).filter(code => code !== baseCurrency);

    if (currencyCodes.length === 0) {
      this.logger.warn('No hay divisas configuradas para actualizar.');
      return { message: 'No hay divisas para actualizar.', rates_updated: 0 };
    }

    const auth = 'Basic ' + Buffer.from(`${apiId}:${apiKey}`).toString('base64');
    const url = `${this.xeApiBaseUrl}/rates/historical.json?from=${baseCurrency}&to=${currencyCodes.join(',')}&date=${new Date().toISOString().split('T')[0]}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { headers: { Authorization: auth } }),
      );

      const ratesData = response.data?.to;
      if (!ratesData) {
        throw new Error('La respuesta de la API de Xe no contiene tasas de cambio.');
      }
      
      const today = new Date();
      let updatedCount = 0;

      for (const currencyCode in ratesData) {
          const rateValue = ratesData[currencyCode];
          
          const newRate = this.exchangeRateRepository.create({
              fromCurrency: baseCurrency,
              toCurrency: currencyCode,
              rate: rateValue,
              date: today,
          });

          await this.exchangeRateRepository.save(newRate);
          updatedCount++;
      }

      this.logger.log(`Se actualizaron ${updatedCount} tasas de cambio desde Xe.`);
      return { message: 'Tasas de cambio actualizadas exitosamente.', rates_updated: updatedCount };

    } catch (error) {
      this.logger.error('Error al obtener las tasas de cambio de Xe:', error.response?.data || error.message);
      throw new Error('No se pudieron obtener las tasas de cambio.');
    }
  }
}