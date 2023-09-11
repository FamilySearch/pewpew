// Expired should be lowest so we can check for ones that don't require auth
export enum AuthPermission {
  Expired = 1,
  NoAuth = 2,
  ReadOnly = 3,
  User = 4,
  Admin = 5
}

export interface TokenResponse {
  token: string;
  refreshToken?: string;
  hintToken?: string;
}

export interface AuthPermissions {
  token: string | undefined;
  authPermission: AuthPermission;
  userId?: string | null;
  groups?: string[];
}
