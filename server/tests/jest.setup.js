"use strict";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET ?? 'test-refresh-secret';
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? '';
process.env.ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL ?? '15m';
process.env.REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL ?? '7d';
process.env.TOKEN_ISSUER = process.env.TOKEN_ISSUER ?? 'test-issuer';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS ?? '4';
//# sourceMappingURL=jest.setup.js.map