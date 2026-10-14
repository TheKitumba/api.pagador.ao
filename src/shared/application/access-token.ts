import type { Role } from '@prisma/client';

/** Claims carried by the RS256 access token (docs/09, 9.7.1). */
export interface AccessTokenPayload {
  sub: string;
  tid: string;
  cid: string;
  eid: string | null;
  name: string;
  roles: Role[];
}
