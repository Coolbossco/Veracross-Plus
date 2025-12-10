import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/prisma';

const refreshStore = new Map<string, any>();

jest.mock('../src/prisma', () => ({
  __esModule: true,
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn()
    },
    session: {
      upsert: jest.fn(),
      update: jest.fn()
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn()
    },
    auditEvent: {
      create: jest.fn()
    }
  }
}));

type MockedPrisma = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  session: {
    upsert: jest.Mock;
    update: jest.Mock;
  };
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
  auditEvent: {
    create: jest.Mock;
  };
};

const mockPrisma = prisma as unknown as MockedPrisma;

const mockSession = { id: 'session-1', userId: 'user-1', deviceId: 'device-1' };

describe('Auth routes', () => {
  beforeEach(() => {
    refreshStore.clear();

    mockPrisma.user.findUnique = jest.fn();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create = jest.fn();
    mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({
      id: 'user-1',
      email: data.email,
      passwordHash: data.passwordHash
    }));
    mockPrisma.session.upsert = jest.fn();
    mockPrisma.session.upsert.mockResolvedValue(mockSession);
    mockPrisma.session.update = jest.fn();
    mockPrisma.session.update.mockResolvedValue(mockSession);

    mockPrisma.refreshToken.create = jest.fn();
    mockPrisma.refreshToken.create.mockImplementation(async ({ data }: any) => {
      refreshStore.set(data.id, { ...data, revoked: false });
      return data;
    });
    mockPrisma.refreshToken.findUnique = jest.fn();
    mockPrisma.refreshToken.findUnique.mockImplementation(async ({ where }: any) => {
      const record = refreshStore.get(where.id);
      return record ? { ...record, id: where.id } : null;
    });
    mockPrisma.refreshToken.updateMany = jest.fn();
    mockPrisma.refreshToken.updateMany.mockImplementation(async ({ where }: any) => {
      const record = refreshStore.get(where.id);
      if (record) {
        refreshStore.set(where.id, { ...record, revoked: true });
        return { count: 1 };
      }
      return { count: 0 };
    });
    mockPrisma.auditEvent.create = jest.fn();
    mockPrisma.auditEvent.create.mockResolvedValue({});
  });

  const signupPayload = {
    email: 'user@example.com',
    password: 'StrongPass123!',
    deviceId: 'device-1'
  };

  const loginPayload = {
    email: 'user@example.com',
    password: 'StrongPass123!',
    deviceId: 'device-1'
  };

  const performSignup = () =>
    request(createApp())
      .post('/api/auth/signup')
      .send(signupPayload);

  const performLogin = () =>
    request(createApp())
      .post('/api/auth/login')
      .send(loginPayload);

  it('allows a user to sign up with email and password', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/signup')
      .send(signupPayload)
      .expect(201);

    expect(response.body.email).toBe(signupPayload.email.toLowerCase());
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();

    const hashedPassword = (mockPrisma.user.create.mock.calls[0][0] as any).data.passwordHash;
    expect(hashedPassword).not.toEqual(signupPayload.password);
    expect(await bcrypt.compare(signupPayload.password, hashedPassword)).toBe(true);
  });

  it('rejects duplicate email registration', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'existing-id',
      email: signupPayload.email,
      passwordHash: 'hash'
    });

    const app = createApp();
    await request(app)
      .post('/api/auth/signup')
      .send(signupPayload)
      .expect(409);
  });

  it('allows a user to log in with correct credentials', async () => {
    const passwordHash = await bcrypt.hash(loginPayload.password, config.bcryptRounds);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: loginPayload.email.toLowerCase(),
      passwordHash
    });

    const app = createApp();
    const response = await request(app)
      .post('/api/auth/login')
      .send(loginPayload)
      .expect(200);

    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();
  });

  it('rejects invalid login attempts', async () => {
    const passwordHash = await bcrypt.hash('differentPassword123', config.bcryptRounds);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: loginPayload.email.toLowerCase(),
      passwordHash
    });

    const app = createApp();
    await request(app)
      .post('/api/auth/login')
      .send(loginPayload)
      .expect(401);
  });

  it('refreshes tokens with a valid refresh token', async () => {
    const passwordHash = await bcrypt.hash(loginPayload.password, config.bcryptRounds);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: loginPayload.email.toLowerCase(),
      passwordHash
    });

    const app = createApp();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send(loginPayload)
      .expect(200);

    const refreshToken = loginResponse.body.refreshToken;
    const decoded = jwt.decode(refreshToken) as jwt.JwtPayload;
    const record = refreshStore.get(decoded.tid as string);
    const hash = await bcrypt.hash(refreshToken, config.bcryptRounds);
    refreshStore.set(decoded.tid as string, { ...record, hash });

    const refreshResponse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(refreshResponse.body.accessToken).toBeDefined();
    expect(refreshResponse.body.refreshToken).toBeDefined();
  });

  it('logs out by revoking the refresh token', async () => {
    const passwordHash = await bcrypt.hash(loginPayload.password, config.bcryptRounds);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: loginPayload.email.toLowerCase(),
      passwordHash
    });

    const app = createApp();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send(loginPayload)
      .expect(200);

    const refreshToken = loginResponse.body.refreshToken;
    const decoded = jwt.decode(refreshToken) as jwt.JwtPayload;
    const record = refreshStore.get(decoded.tid as string);
    const hash = await bcrypt.hash(refreshToken, config.bcryptRounds);
    refreshStore.set(decoded.tid as string, { ...record, hash });

    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(204);

    const stored = refreshStore.get(decoded.tid as string);
    expect(stored?.revoked).toBe(true);
  });

  it('rejects refresh with invalid token', async () => {
    const app = createApp();
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid_refresh_token_value' })
      .expect(401);
  });
});
