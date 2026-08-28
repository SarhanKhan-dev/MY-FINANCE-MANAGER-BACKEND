import { User } from '@prisma/client';

export type SafeUser = Omit<User, 'passwordHash' | 'pinHash'>;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, pinHash: _pinHash, ...safe } = user;
  return safe;
}
