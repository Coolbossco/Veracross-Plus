import request from 'supertest';
import { createApp } from '../src/app';
import { createAccessToken } from '../src/utils/tokens';
import { prisma } from '../src/prisma';

jest.mock('../src/prisma', () => ({
  __esModule: true,
  prisma: {
    customAssignment: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn()
    },
    session: {
      findUnique: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

type MockedPrisma = {
  customAssignment: {
    findMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  session: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockPrisma = prisma as unknown as MockedPrisma;

describe('Custom assignments routes', () => {
  const token = createAccessToken('user-1', 'session-1');

  beforeEach(() => {
    mockPrisma.session.findUnique = jest.fn();
    mockPrisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
    mockPrisma.customAssignment.findMany = jest.fn();
    mockPrisma.customAssignment.create = jest.fn();
    mockPrisma.customAssignment.findFirst = jest.fn();
    mockPrisma.customAssignment.update = jest.fn();
    mockPrisma.customAssignment.delete = jest.fn();
    mockPrisma.customAssignment.deleteMany = jest.fn();
    mockPrisma.customAssignment.createMany = jest.fn();
    mockPrisma.$transaction = jest.fn().mockImplementation(async (callback) => {
      await callback(mockPrisma);
    });
  });

  it('returns assignments list', async () => {
    mockPrisma.customAssignment.findMany.mockResolvedValue([{ id: 'assign-1', userId: 'user-1', title: 'Test', status: 'pending' }]);
    const app = createApp();
    const response = await request(app)
      .get('/api/custom-assignments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
  });

  it('creates a new assignment', async () => {
    mockPrisma.customAssignment.create.mockResolvedValue({ id: 'a1', userId: 'user-1', title: 'New', status: 'pending' });
    const app = createApp();
    const response = await request(app)
      .post('/api/custom-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New' })
      .expect(201);

    expect(response.body.title).toBe('New');
  });

  it('updates assignment when owned by user', async () => {
    mockPrisma.customAssignment.findFirst.mockResolvedValue({ id: 'assign-1', userId: 'user-1' });
    mockPrisma.customAssignment.update.mockResolvedValue({ id: 'assign-1', userId: 'user-1', title: 'Updated' });
    const app = createApp();

    const response = await request(app)
      .put('/api/custom-assignments/assign-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated' })
      .expect(200);

    expect(response.body.title).toBe('Updated');
  });

  it('rejects update when assignment missing', async () => {
    mockPrisma.customAssignment.findFirst.mockResolvedValue(null);
    const app = createApp();

    await request(app)
      .put('/api/custom-assignments/missing')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated' })
      .expect(404);
  });

  it('bulk syncs assignments', async () => {
    mockPrisma.customAssignment.findMany.mockResolvedValue([
      { id: 'assign-1', userId: 'user-1', title: 'Existing', status: 'pending', description: null, courseName: null, dueDate: null, externalId: null },
      { id: 'assign-2', userId: 'user-1', title: 'Old', status: 'pending', description: null, courseName: null, dueDate: null, externalId: null }
    ]);
    mockPrisma.customAssignment.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.customAssignment.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.customAssignment.update.mockResolvedValue({});

    const app = createApp();

    const response = await request(app)
      .put('/api/custom-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assignments: [
          {
            id: 'assign-1',
            title: 'Existing Updated',
            status: 'pending'
          },
          {
            id: 'assign-3',
            title: 'New Assignment',
            status: 'pending'
          }
        ]
      })
      .expect(200);

    expect(mockPrisma.customAssignment.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        id: { in: ['assign-2'] }
      }
    });
    expect(mockPrisma.customAssignment.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ id: 'assign-3', title: 'New Assignment' })
      ]),
      skipDuplicates: true
    });
    expect(mockPrisma.customAssignment.update).toHaveBeenCalledWith({
      where: { id: 'assign-1' },
      data: expect.objectContaining({ title: 'Existing Updated' })
    });
    expect(response.body).toEqual({
      created: 1,
      updated: 1,
      deleted: 1
    });
  });
});

