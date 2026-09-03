import { EntityManager } from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * A tenant has just been materialised.
 *
 * Emitted from inside the transaction that creates it, so `entityManager` is the ONLY manager a
 * listener may read or write through — a second connection cannot see uncommitted rows. Anything
 * that must not happen unless the transaction commits (an email, a queue job, an outbound
 * webhook) goes through `AfterCommitService` with this manager.
 */
export class UserRegisteredEvent {
  constructor(
    public readonly user: User,
    public readonly organization: Organization,
    public readonly entityManager: EntityManager,
    /**
     * Whether this signup created a NEW person, or an existing customer added a second company.
     *
     * The two deserve different mail: the first is a welcome, the second is
     * `organization-added`. Without this flag a returning customer registering their third
     * organization gets welcomed to a product they have used for a year.
     */
    public readonly isNewIdentity: boolean,
  ) {}
}
