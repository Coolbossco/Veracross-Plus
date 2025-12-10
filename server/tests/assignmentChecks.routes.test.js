"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = require("../src/app");
const tokens_1 = require("../src/utils/tokens");
const prisma_1 = require("../src/prisma");
jest.mock('../src/prisma', () => ({
    __esModule: true,
    prisma: {
        assignmentCheck: {
            findMany: jest.fn(),
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
            updateMany: jest.fn(),
            createMany: jest.fn()
        },
        session: {
            findUnique: jest.fn()
        },
        $transaction: jest.fn()
    }
}));
const mockPrisma = prisma_1.prisma;
describe('Assignment checks routes', () => {
    const token = (0, tokens_1.createAccessToken)('user-1', 'session-1');
    beforeEach(() => {
        mockPrisma.session.findUnique = jest.fn();
        mockPrisma.session.findUnique.mockResolvedValue({ id: 'session-1', userId: 'user-1' });
        mockPrisma.assignmentCheck.findMany = jest.fn();
        mockPrisma.assignmentCheck.create = jest.fn();
        mockPrisma.assignmentCheck.findUnique = jest.fn();
        mockPrisma.assignmentCheck.update = jest.fn();
        mockPrisma.assignmentCheck.delete = jest.fn();
        mockPrisma.assignmentCheck.deleteMany = jest.fn();
        mockPrisma.assignmentCheck.updateMany = jest.fn();
        mockPrisma.assignmentCheck.createMany = jest.fn();
        mockPrisma.$transaction = jest.fn().mockImplementation((actions) => Promise.all(actions));
    });
    it('lists assignment checks', async () => {
        mockPrisma.assignmentCheck.findMany.mockResolvedValue([
            { id: 'c1', userId: 'user-1', status: 'success', assignmentDate: new Date().toISOString() }
        ]);
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .get('/api/assignment-checks')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(response.body).toHaveLength(1);
    });
    it('creates new assignment check', async () => {
        const now = new Date().toISOString();
        mockPrisma.assignmentCheck.create.mockResolvedValue({
            id: 'c1',
            userId: 'user-1',
            status: 'success',
            assignmentDate: now
        });
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .post('/api/assignment-checks')
            .set('Authorization', `Bearer ${token}`)
            .send({
            assignmentDate: now,
            status: 'success'
        })
            .expect(201);
        expect(response.body.status).toBe('success');
    });
    it('upserts assignment check via PUT', async () => {
        const now = new Date().toISOString();
        mockPrisma.assignmentCheck.findUnique.mockResolvedValue({
            id: 'c1',
            userId: 'user-1',
            assignmentId: 'assign-1'
        });
        mockPrisma.assignmentCheck.update.mockResolvedValue({
            id: 'c1',
            userId: 'user-1',
            assignmentId: 'assign-1',
            status: 'success',
            assignmentDate: now
        });
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .put('/api/assignment-checks/assign-1')
            .set('Authorization', `Bearer ${token}`)
            .send({
            assignmentDate: now,
            status: 'success'
        })
            .expect(200);
        expect(response.body.assignmentId).toBe('assign-1');
    });
    it('deletes assignment check when exists', async () => {
        mockPrisma.assignmentCheck.findUnique.mockResolvedValue({
            id: 'c1',
            userId: 'user-1',
            assignmentId: 'assign-1'
        });
        mockPrisma.assignmentCheck.delete.mockResolvedValue({});
        const app = (0, app_1.createApp)();
        await (0, supertest_1.default)(app)
            .delete('/api/assignment-checks/assign-1')
            .set('Authorization', `Bearer ${token}`)
            .expect(204);
    });
    it('bulk syncs assignment checks', async () => {
        const now = new Date().toISOString();
        mockPrisma.assignmentCheck.findMany.mockResolvedValue([
            { id: 'row-a', assignmentId: 'assign-a' },
            { id: 'row-b', assignmentId: 'assign-b' }
        ]);
        mockPrisma.assignmentCheck.deleteMany.mockResolvedValue({ count: 1 });
        mockPrisma.assignmentCheck.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.assignmentCheck.createMany.mockResolvedValue({ count: 1 });
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .put('/api/assignment-checks')
            .set('Authorization', `Bearer ${token}`)
            .send({
            assignmentIds: ['assign-a', 'assign-c'],
            assignmentDate: now
        })
            .expect(200);
        expect(mockPrisma.assignmentCheck.deleteMany).toHaveBeenCalledWith({
            where: { id: { in: ['row-b'] } }
        });
        expect(mockPrisma.assignmentCheck.updateMany).toHaveBeenCalledWith({
            where: {
                userId: 'user-1',
                assignmentId: { in: ['assign-a'] }
            },
            data: expect.objectContaining({
                status: 'success'
            })
        });
        expect(mockPrisma.assignmentCheck.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({ assignmentId: 'assign-c' })
            ]),
            skipDuplicates: true
        });
        expect(response.body).toEqual({
            created: 1,
            updated: 1,
            deleted: 1
        });
    });
});
//# sourceMappingURL=assignmentChecks.routes.test.js.map