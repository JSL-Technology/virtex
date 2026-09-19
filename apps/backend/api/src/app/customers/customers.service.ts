import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { DataSource } from 'typeorm';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { NotFoundError, UnprocessableEntityError } from '../i18n/localized.exception';
import { IdentityDocumentService } from '../localization/services/identity-document.service';
import { TenantCountryResolver } from '../shared/tenancy/tenant-country.resolver';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly saasService: SaasService,
    private readonly identityDocuments: IdentityDocumentService,
    private readonly tenantCountry: TenantCountryResolver,
  ) {}

  /**
   * Resolve and validate the customer's fiscal identifier.
   *
   * ## What was here before
   *
   * Nothing. `taxId` was a varchar with `@IsString() @IsOptional()` and no type beside it, in a
   * product whose entire purpose is fiscal compliance. Three consequences:
   *
   *   - a mistyped NIT, RUT or RFC was accepted and stored, and surfaced months later when the
   *     authority rejected an invoice built from it. `tax-id-validators.ts` already makes the
   *     argument for why that is worse than a rejected form, and already applies it to the tenant's
   *     own identifier at signup — just not to the tenant's customers;
   *   - with no type recorded, a Dominican RNC and a Dominican cédula in the same column could only
   *     be told apart by length, the heuristic `create-invoice.dto.ts` documents having removed from
   *     the document type for being wrong;
   *   - the label had to read "RNC / Cédula", "CNPJ / CPF", "EIN / TIN" — one input doing the work
   *     of two, named after both.
   *
   * The document's country is the CUSTOMER's, falling back to the tenant's. An exporter's customers
   * are abroad by definition, and checking a Panamanian buyer's RUC against Dominican rules would
   * reject every one of them.
   */
  private async resolveIdentityDocument(
    dto: Partial<CreateCustomerDto>,
    organizationId: string,
  ): Promise<Partial<Customer>> {
    if (!dto.taxId?.trim()) {
      return { taxId: undefined, identityDocumentTypeCode: null, identityDocumentCountry: null };
    }

    const resolved = await this.identityDocuments.resolveParty({
      value: dto.taxId,
      typeCode: dto.identityDocumentTypeCode,
      documentCountry: dto.identityDocumentCountry,
      fallbackCountry: await this.tenantCountry.resolve(organizationId),
      // A customer may be a company or a natural person and the form does not force the question,
      // so both kinds of document are on offer and the chosen one decides.
      appliesTo: 'both',
      usedFor: 'invoicing',
    });

    if (!resolved.ok) {
      switch (resolved.reason) {
        case 'type_required':
          throw new UnprocessableEntityError('contacts.customer_form.document_type_required', {
            country: resolved.country,
          });
        case 'type_not_issued':
          throw new UnprocessableEntityError('contacts.customer_form.document_type_not_issued', {
            code: resolved.code,
            country: resolved.country,
          });
        default:
          throw new UnprocessableEntityError('contacts.customer_form.document_invalid', {
            document: resolved.documentLabel,
          });
      }
    }

    return {
      // The canonical form, by the catalogue's rule for THIS document. The unique index compares
      // it, so `900123456-8` and `9001234568` are recognised as the same customer instead of
      // being saved twice.
      taxId: resolved.value ?? undefined,
      identityDocumentTypeCode: resolved.typeCode,
      identityDocumentCountry: resolved.countryCode,
    };
  }

  /**
   * Create a customer, against the tenant's plan.
   *
   * Metered in the same transaction as the insert. Counting outside it lets a rolled-back create
   * still consume quota, and counting after it lets a burst of concurrent requests all observe the
   * same pre-increment total and all proceed.
   */
  async create(
    createCustomerDto: CreateCustomerDto,
    organizationId: string,
  ): Promise<Customer> {
    // Validated before the transaction opens: a rejected tax id should not have held a row lock
    // or consumed the plan-limit check on its way to failing.
    const identity = await this.resolveIdentityDocument(createCustomerDto, organizationId);

    return this.dataSource.transaction(async (manager) => {
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.CUSTOMERS);

      const customer = manager.create(Customer, {
        ...createCustomerDto,
        ...identity,
        organizationId,
      });
      return manager.save(customer);
    });
  }

  /**
   * The tenant's customers, optionally narrowed to what the caller is looking for.
   *
   * ## Why the search happens here
   *
   * Every picker in the client used to fetch this endpoint whole and filter the array in the
   * browser. That works for the tenant with forty customers and fails silently for the one with
   * twenty thousand: the response is megabytes, the operator waits for all of it before the first
   * keystroke does anything, and the filter then runs over a list the browser is already
   * struggling to hold. A `WHERE` clause is the part of that job a database does in a millisecond.
   *
   * Both halves are optional and BOTH DEFAULTS ARE THE OLD BEHAVIOUR — no `search`, no `limit`,
   * same full list in the same order — so nothing that calls this today changes.
   *
   * Matched against the three things an operator actually knows: the name, the fiscal identifier
   * and the e-mail address. `ILIKE` rather than `=` because a customer is looked for by fragment;
   * the wildcards in the term itself are escaped, so a search for `100%` looks for a literal
   * `100%` instead of matching every row in the table.
   */
  findAll(
    organizationId: string,
    options: { search?: string; limit?: number } = {},
  ): Promise<Customer[]> {
    const query = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.organizationId = :organizationId', { organizationId })
      .orderBy('customer.companyName', 'ASC');

    const term = options.search?.trim();
    if (term) {
      query.andWhere(
        `(customer.companyName ILIKE :term
          OR customer.taxId ILIKE :term
          OR customer.email ILIKE :term)`,
        { term: `%${term.replace(/[\\%_]/g, '\\$&')}%` },
      );
    }

    if (options.limit !== undefined && options.limit > 0) {
      query.take(options.limit);
    }

    return query.getMany();
  }

  async findOne(id: string, organizationId: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundError('customers.customer_id_not_found', { id });
    }
    return customer;
  }

  async update(
    id: string,
    updateCustomerDto: UpdateCustomerDto,
    organizationId: string,
  ): Promise<Customer> {
    const customer = await this.findOne(id, organizationId);

    // Re-validate when either half moves. Changing only the TYPE — correcting an RNC filed as a
    // cédula — has to re-check the value against the new rule, which a guard on `taxId` alone
    // would miss.
    const identityTouched =
      updateCustomerDto.taxId !== undefined ||
      updateCustomerDto.identityDocumentTypeCode !== undefined ||
      updateCustomerDto.identityDocumentCountry !== undefined;

    const updatedCustomer = this.customerRepository.merge(customer, updateCustomerDto);
    if (identityTouched) {
      Object.assign(
        updatedCustomer,
        await this.resolveIdentityDocument(
          {
            taxId: updateCustomerDto.taxId ?? customer.taxId,
            identityDocumentTypeCode:
              updateCustomerDto.identityDocumentTypeCode ?? customer.identityDocumentTypeCode ?? undefined,
            identityDocumentCountry:
              updateCustomerDto.identityDocumentCountry ?? customer.identityDocumentCountry ?? undefined,
          },
          organizationId,
        ),
      );
    }
    return this.customerRepository.save(updatedCustomer);
  }

  /**
   * Delete a customer, and give the seat of quota back.
   *
   * `CUSTOMERS` is a LIFETIME quota, so without the release it counted "customers ever created"
   * rather than "customers that exist" — a tenant at its limit could delete every record it had
   * and still be unable to create one. Both happen in the same transaction, so a failed delete
   * cannot hand out free quota.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const customer = await this.findOne(id, organizationId);
    await this.dataSource.transaction(async (manager) => {
      await manager.remove(Customer, customer);
      await this.saasService.releaseUsage(manager, organizationId, SaasResource.CUSTOMERS);
    });
  }
}