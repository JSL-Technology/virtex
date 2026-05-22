import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class JsonLogger extends ConsoleLogger {
  override formatPid(pid: number): string {
    return `[${pid}]`;
  }

  override log(message: any, ...optionalParams: any[]) {
    if (process.env.NODE_ENV === 'production') {
      console.log(JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), context: optionalParams[0] }));
    } else {
      super.log(message, ...optionalParams);
    }
  }

  override error(message: any, ...optionalParams: any[]) {
    if (process.env.NODE_ENV === 'production') {
      console.error(JSON.stringify({ level: 'error', message, timestamp: new Date().toISOString(), context: optionalParams[0] }));
    } else {
      super.error(message, ...optionalParams);
    }
  }

  override warn(message: any, ...optionalParams: any[]) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(JSON.stringify({ level: 'warn', message, timestamp: new Date().toISOString(), context: optionalParams[0] }));
    } else {
      super.warn(message, ...optionalParams);
    }
  }

  override debug(message: any, ...optionalParams: any[]) {
    if (process.env.NODE_ENV === 'production') {
        // Skip debug in production usually, or log as debug level
    } else {
      super.debug(message, ...optionalParams);
    }
  }

  override verbose(message: any, ...optionalParams: any[]) {
    if (process.env.NODE_ENV !== 'production') {
      super.verbose(message, ...optionalParams);
    }
  }
}
