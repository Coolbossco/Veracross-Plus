import request from 'supertest';
import { createApp } from '../src/app';
import { createAccessToken } from '../src/utils/tokens';
import { prisma } from '../src/prisma';

jest.mock('../src/prisma', () => ({
  __esModule: true,
  prisma: {
    userSettings: {
      upsert: jest.fn()
    },
    session: {
      findUnique: jest.fn()
    }
  }
}));

type MockedPrisma = {
  userSettings: {
    upsert: jest.Mock;
  };
  session: {
    findUnique: jest.Mock;
  };
};

const mockPrisma = prisma as unknown as MockedPrisma;

describe('Settings routes', () => {
  beforeEach(() => {
    mockPrisma.session.findUnique = jest.fn();
    mockPrisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    mockPrisma.userSettings.upsert = jest.fn();
  });

  it('returns settings for authenticated user', async () => {
    mockPrisma.userSettings.upsert.mockResolvedValue({
      userId: 'user-1',
      notificationsEnabled: true,
      syncEnabled: true
    });
    const token = createAccessToken('user-1', 'session-1');
    const app = createApp();

    const response = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.userId).toBe('user-1');
    expect(mockPrisma.userSettings.upsert).toHaveBeenCalled();
  });

  it('updates settings for authenticated user', async () => {
    mockPrisma.userSettings.upsert.mockResolvedValue({
      userId: 'user-1',
      notificationsEnabled: false,
      syncEnabled: true
    });
    const token = createAccessToken('user-1', 'session-1');
    const app = createApp();

    const response = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ notificationsEnabled: false })
      .expect(200);

    expect(response.body.notificationsEnabled).toBe(false);
  });

  it('rejects unauthenticated access', async () => {
    const app = createApp();

    await request(app).get('/api/settings').expect(401);
  });
});

