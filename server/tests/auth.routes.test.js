"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const app_1 = require("../src/app");
const config_1 = require("../src/config");
const prisma_1 = require("../src/prisma");
const refreshStore = new Map();
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
const mockPrisma = prisma_1.prisma;
const mockSession = { id: 'session-1', userId: 'user-1', deviceId: 'device-1' };
describe('Auth routes', () => {
    beforeEach(() => {
        refreshStore.clear();
        mockPrisma.user.findUnique = jest.fn();
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.user.create = jest.fn();
        mockPrisma.user.create.mockImplementation(async ({ data }) => ({
            id: 'user-1',
            email: data.email,
            passwordHash: data.passwordHash
        }));
        mockPrisma.session.upsert = jest.fn();
        mockPrisma.session.upsert.mockResolvedValue(mockSession);
        mockPrisma.session.update = jest.fn();
        mockPrisma.session.update.mockResolvedValue(mockSession);
        mockPrisma.refreshToken.create = jest.fn();
        mockPrisma.refreshToken.create.mockImplementation(async ({ data }) => {
            refreshStore.set(data.id, { ...data, revoked: false });
            return data;
        });
        mockPrisma.refreshToken.findUnique = jest.fn();
        mockPrisma.refreshToken.findUnique.mockImplementation(async ({ where }) => {
            const record = refreshStore.get(where.id);
            return record ? { ...record, id: where.id } : null;
        });
        mockPrisma.refreshToken.updateMany = jest.fn();
        mockPrisma.refreshToken.updateMany.mockImplementation(async ({ where }) => {
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
    const performSignup = () => (0, supertest_1.default)((0, app_1.createApp)())
        .post('/api/auth/signup')
        .send(signupPayload);
    const performLogin = () => (0, supertest_1.default)((0, app_1.createApp)())
        .post('/api/auth/login')
        .send(loginPayload);
    it('allows a user to sign up with email and password', async () => {
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .post('/api/auth/signup')
            .send(signupPayload)
            .expect(201);
        expect(response.body.email).toBe(signupPayload.email.toLowerCase());
        expect(response.body.accessToken).toBeDefined();
        expect(response.body.refreshToken).toBeDefined();
        const hashedPassword = mockPrisma.user.create.mock.calls[0][0].data.passwordHash;
        expect(hashedPassword).not.toEqual(signupPayload.password);
        expect(await bcryptjs_1.default.compare(signupPayload.password, hashedPassword)).toBe(true);
    });
    it('rejects duplicate email registration', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: 'existing-id',
            email: signupPayload.email,
            passwordHash: 'hash'
        });
        const app = (0, app_1.createApp)();
        await (0, supertest_1.default)(app)
            .post('/api/auth/signup')
            .send(signupPayload)
            .expect(409);
    });
    it('allows a user to log in with correct credentials', async () => {
        const passwordHash = await bcryptjs_1.default.hash(loginPayload.password, config_1.config.bcryptRounds);
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: loginPayload.email.toLowerCase(),
            passwordHash
        });
        const app = (0, app_1.createApp)();
        const response = await (0, supertest_1.default)(app)
            .post('/api/auth/login')
            .send(loginPayload)
            .expect(200);
        expect(response.body.accessToken).toBeDefined();
        expect(response.body.refreshToken).toBeDefined();
    });
    it('rejects invalid login attempts', async () => {
        const passwordHash = await bcryptjs_1.default.hash('differentPassword123', config_1.config.bcryptRounds);
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: loginPayload.email.toLowerCase(),
            passwordHash
        });
        const app = (0, app_1.createApp)();
        await (0, supertest_1.default)(app)
            .post('/api/auth/login')
            .send(loginPayload)
            .expect(401);
    });
    it('refreshes tokens with a valid refresh token', async () => {
        const passwordHash = await bcryptjs_1.default.hash(loginPayload.password, config_1.config.bcryptRounds);
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: loginPayload.email.toLowerCase(),
            passwordHash
        });
        const app = (0, app_1.createApp)();
        const loginResponse = await (0, supertest_1.default)(app)
            .post('/api/auth/login')
            .send(loginPayload)
            .expect(200);
        const refreshToken = loginResponse.body.refreshToken;
        const decoded = jsonwebtoken_1.default.decode(refreshToken);
        const record = refreshStore.get(decoded.tid);
        const hash = await bcryptjs_1.default.hash(refreshToken, config_1.config.bcryptRounds);
        refreshStore.set(decoded.tid, { ...record, hash });
        const refreshResponse = await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(200);
        expect(refreshResponse.body.accessToken).toBeDefined();
        expect(refreshResponse.body.refreshToken).toBeDefined();
    });
    it('logs out by revoking the refresh token', async () => {
        const passwordHash = await bcryptjs_1.default.hash(loginPayload.password, config_1.config.bcryptRounds);
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: loginPayload.email.toLowerCase(),
            passwordHash
        });
        const app = (0, app_1.createApp)();
        const loginResponse = await (0, supertest_1.default)(app)
            .post('/api/auth/login')
            .send(loginPayload)
            .expect(200);
        const refreshToken = loginResponse.body.refreshToken;
        const decoded = jsonwebtoken_1.default.decode(refreshToken);
        const record = refreshStore.get(decoded.tid);
        const hash = await bcryptjs_1.default.hash(refreshToken, config_1.config.bcryptRounds);
        refreshStore.set(decoded.tid, { ...record, hash });
        await (0, supertest_1.default)(app)
            .post('/api/auth/logout')
            .send({ refreshToken })
            .expect(204);
        const stored = refreshStore.get(decoded.tid);
        expect(stored?.revoked).toBe(true);
    });
    it('rejects refresh with invalid token', async () => {
        const app = (0, app_1.createApp)();
        await (0, supertest_1.default)(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 'invalid_refresh_token_value' })
            .expect(401);
    });
});
//# sourceMappingURL=auth.routes.test.js.map