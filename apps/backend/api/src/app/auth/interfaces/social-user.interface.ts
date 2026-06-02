export interface SocialUser {
  provider: string;
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  picture?: string;
  accessToken?: string;
  refreshToken?: string;
  // M-02: Whether the identity provider asserts the email address is verified.
  // Required before an OAuth identity may be linked to an existing local account.
  emailVerified?: boolean;
}
