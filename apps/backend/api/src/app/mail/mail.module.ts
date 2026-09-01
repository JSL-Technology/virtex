import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { I18nService } from '../i18n/i18n.service';
import { mailTemplateHelpers } from './mail-template.helpers';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { FrontendUrlService } from './frontend-url.service';
import { MAIL_QUEUE } from './mail.queue';

@Module({
  imports: [
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    MailerModule.forRootAsync({
      useFactory: async (config: ConfigService, i18n: I18nService) => ({
        transport: {
          host: config.get<string>('MAIL_HOST'),
          // Read as a number. Nodemailer treats a string port as a hostname-ish value and the
          // connection fails with a message that names neither the port nor the cause.
          port: config.get<number>('MAIL_PORT', 587),
          // Implicit TLS on 465; STARTTLS on 587. This was hardcoded `false`, so a provider that
          // only offers 465 (a common default) could not be configured at all.
          secure: config.get<boolean>('MAIL_SECURE', false),
          auth: config.get<string>('MAIL_USER')
            ? {
                user: config.get<string>('MAIL_USER'),
                pass: config.get<string>('MAIL_PASSWORD'),
              }
            : undefined,
        },
        defaults: {
          from: `"${config.get<string>('MAIL_FROM_NAME', 'Virteex')}" <${config.get<string>(
            'MAIL_FROM_ADDRESS',
          )}>`,
        },
        template: {
          dir: __dirname + '/templates',
          // One template per email, in every language: the copy lives in the catalogue and the
          // template carries `{{t 'KEY'}}` holes. See `mail-template.helpers.ts` for why this
          // beats thirty files that drift apart.
          adapter: new HandlebarsAdapter(mailTemplateHelpers(i18n)),
          options: {
            strict: true,
          },
        },
      }),
      inject: [ConfigService, I18nService],
    }),
  ],
  providers: [MailService, MailProcessor, FrontendUrlService],
  exports: [MailService, FrontendUrlService],
})
export class MailModule {}
