/** Somebody became an active member of a company: they set their password from an invitation, or accepted one. */
export const MEMBER_JOINED = 'organization.member.joined';

export interface MemberJoinedEvent {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  /** Who invited them, when that is on record. */
  invitedById: string | null;
}
