// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
// RM security-audit: CWE-532 regression test — OAuth token material must never reach the logger.

import {net} from 'electron';
import log from 'electron-log';
import {EventEmitter} from 'events';

import {TokenManager} from 'main/tokenManager';

const FAKE_ACCESS = 'POC_ACCESS_FAKE';
const FAKE_REFRESH = 'POC_REFRESH_FAKE';
const FAKE_TOKEN = 'POC_TOKEN_FAKE';

jest.mock('electron', () => ({
    net: {
        request: jest.fn(),
    },
    session: {
        defaultSession: {
            clearStorageData: jest.fn(),
        },
    },
    ipcMain: {
        on: jest.fn(),
    },
    safeStorage: {
        isEncryptionAvailable: jest.fn(() => false),
    },
}));

jest.mock('electron-log', () => ({
    silly: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('main/constants', () => ({
    tokensStorePath: '/tmp/tokenManager.test-tokens.json',
}));

jest.mock('fs', () => ({
    readFileSync: jest.fn(() => {
        throw new Error('no store file in test');
    }),
    writeFileSync: jest.fn(),
}));

type FakeRequest = EventEmitter & {
    setHeader: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
};

const collectLoggedText = () => ([log.silly, log.debug, log.info, log.warn, log.error] as jest.Mock[]).
    flatMap((fn) => fn.mock.calls.flat()).
    map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).
    join('\n');

describe('tokenManager CWE-532', () => {
    it('does not log OAuth token material when refreshing the token', async () => {
        (net.request as jest.Mock).mockImplementation(() => {
            const req = new EventEmitter() as FakeRequest;
            req.setHeader = jest.fn();
            req.write = jest.fn();
            req.end = jest.fn(() => {
                const response = new EventEmitter() as EventEmitter & {statusCode: number};
                response.statusCode = 200;
                process.nextTick(() => {
                    response.emit('data', Buffer.from(JSON.stringify({
                        access_token: FAKE_ACCESS,
                        refresh_token: FAKE_REFRESH,
                        expires_in: '3600',
                    })));
                    response.emit('end');
                });
                req.emit('response', response);
            });
            return req;
        });

        const tokenManager = new TokenManager('/tmp/tokenManager.test-tokens.json');
        tokenManager.data = {token: 'stale-token', refreshToken: FAKE_REFRESH};

        const result = await tokenManager.handleRefreshToken();

        expect(result.token).toBe(FAKE_ACCESS);
        expect(collectLoggedText()).not.toContain(FAKE_ACCESS);
        expect(collectLoggedText()).not.toContain(FAKE_REFRESH);
    });

    it('does not log OAuth token material when revoking the token', async () => {
        (net.request as jest.Mock).mockImplementation(() => {
            const req = new EventEmitter() as FakeRequest;
            req.setHeader = jest.fn();
            req.write = jest.fn();
            req.end = jest.fn(() => {
                const response = new EventEmitter() as EventEmitter & {statusCode: number};
                response.statusCode = 200;
                process.nextTick(() => {
                    response.emit('end');
                });
                req.emit('response', response);
            });
            return req;
        });

        const tokenManager = new TokenManager('/tmp/tokenManager.test-tokens.json');
        tokenManager.data = {token: FAKE_TOKEN};

        await tokenManager.handleRevokeToken();

        expect(collectLoggedText()).not.toContain(FAKE_TOKEN);
    });

    it('does not leak response headers in the refresh token error path', async () => {
        (net.request as jest.Mock).mockImplementation(() => {
            const req = new EventEmitter() as FakeRequest;
            req.setHeader = jest.fn();
            req.write = jest.fn();
            req.end = jest.fn(() => {
                const response = new EventEmitter() as EventEmitter & {statusCode: number;headers: Record<string, string>};
                response.statusCode = 401;
                response.headers = {'www-authenticate': 'POC_HEADER_MATERIAL'};
                req.emit('response', response);
            });
            return req;
        });

        const tokenManager = new TokenManager('/tmp/tokenManager.test-tokens.json');
        tokenManager.data = {token: FAKE_TOKEN, refreshToken: FAKE_REFRESH};

        const refreshError = await tokenManager.handleRefreshToken().catch((e) => e);
        expect(refreshError.message).toContain('token refresh 401');
        expect(refreshError.message).not.toContain('POC_HEADER_MATERIAL');
        expect(collectLoggedText()).not.toContain('POC_HEADER_MATERIAL');
    });

    it('does not leak response headers in the revoke token error path', async () => {
        (net.request as jest.Mock).mockImplementation(() => {
            const req = new EventEmitter() as FakeRequest;
            req.setHeader = jest.fn();
            req.write = jest.fn();
            req.end = jest.fn(() => {
                const response = new EventEmitter() as EventEmitter & {statusCode: number;headers: Record<string, string>};
                response.statusCode = 401;
                response.headers = {'www-authenticate': 'POC_HEADER_MATERIAL'};
                req.emit('response', response);
            });
            return req;
        });

        const tokenManager = new TokenManager('/tmp/tokenManager.test-tokens.json');
        tokenManager.data = {token: FAKE_TOKEN};

        const revokeError = await tokenManager.handleRevokeToken().catch((e) => e);
        expect(revokeError.message).toContain('token revoke 401');
        expect(revokeError.message).not.toContain('POC_HEADER_MATERIAL');
        expect(collectLoggedText()).not.toContain('POC_HEADER_MATERIAL');
    });
});

