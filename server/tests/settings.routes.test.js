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
        userSettings: {
            upsert: jest.fn()
        },
        session: {
            findUnique: jest.fn()
        }
    }
}));
const mockPrisma = prisma_1.prisma;
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
        const token = (0, tokens_1.createAccessToken)('user-1', 'session-1');
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
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
        const token = (0, tokens_1.createAccessToken)('user-1', 'session-1');
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .put('/api/settings')
            .set('Authorization', `Bearer ${token}`)
            .send({ notificationsEnabled: false })
            .expect(200);
        expect(response.body.notificationsEnabled).toBe(false);
    });
    it('rejects unauthenticated access', async () => {
        const app = (0, app_1.createApp)();
        await (0, supertest_1.default)(app).get('/api/settings').expect(401);
    });
});
//# sourceMappingURL=settings.routes.test.js.map