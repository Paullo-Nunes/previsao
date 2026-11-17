import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from './server.js';

let server;
let baseUrl;
const testNow = Date.UTC(2026, 0, 15, 12);
let currentNow = testNow;
let upstreamCalls = 0;

async function startServer(options) {
    server = createServer(options);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
    await startServer({
        apiKey: 'test-key',
        now: () => currentNow,
        fetchImpl: async (url) => {
            upstreamCalls += 1;
            const requestUrl = new URL(url);
            assert.equal(requestUrl.searchParams.get('appid'), 'test-key');

            if (requestUrl.pathname.endsWith('/forecast')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        city: { timezone: 0 },
                        list: [
                            {
                                dt: Date.UTC(2026, 0, 15, 15) / 1000,
                                main: { temp_min: 17, temp_max: 23 }
                            },
                            {
                                dt: Date.UTC(2026, 0, 15, 18) / 1000,
                                main: { temp_min: 15, temp_max: 26 }
                            },
                            {
                                dt: Date.UTC(2026, 0, 16, 0) / 1000,
                                main: { temp_min: 19, temp_max: 24 }
                            }
                        ]
                    })
                };
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    name: 'Recife',
                    sys: { country: 'BR' },
                    main: { temp: 28, temp_max: 30, temp_min: 25, humidity: 70 },
                    weather: [{ description: 'nublado', icon: '03d' }],
                    wind: { speed: 5 }
                })
            };
        }
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
});

test('serves the page and allows only same-origin API requests in CSP', async () => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
});

test('does not expose environment files or backend source as static assets', async () => {
    for (const pathname of ['/.env', '/server.js', '/package.json', '/server.test.js']) {
        const response = await fetch(`${baseUrl}${pathname}`);
        assert.equal(response.status, 404, `${pathname} should not be public`);
    }
});

test('returns validated weather data without returning the API key', async () => {
    const response = await fetch(`${baseUrl}/api/weather?city=Recife`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.city, 'Recife');
    assert.equal(data.temperatureMax, 26);
    assert.equal(data.temperatureMin, 15);
    assert.equal(data.forecastDate, '2026-01-15');
    assert.equal(data.windSpeedKmh, 18);
    assert.equal(JSON.stringify(data).includes('test-key'), false);
});

test('caches successful weather responses by normalized city for five minutes', async () => {
    const callsBeforeCacheHit = upstreamCalls;
    const cachedResponse = await fetch(`${baseUrl}/api/weather?city=recife`);
    const cachedData = await cachedResponse.json();

    assert.equal(cachedResponse.status, 200);
    assert.equal(cachedResponse.headers.get('x-weather-cache'), 'HIT');
    assert.equal(upstreamCalls, callsBeforeCacheHit);
    assert.equal(cachedData.city, 'Recife');

    currentNow += 5 * 60 * 1000 + 1;
    const expiredResponse = await fetch(`${baseUrl}/api/weather?city=recife`);
    assert.equal(expiredResponse.status, 200);
    assert.equal(expiredResponse.headers.get('x-weather-cache'), 'MISS');
    assert.equal(upstreamCalls, callsBeforeCacheHit + 2);
    currentNow = testNow;
});

test('rejects empty city names', async () => {
    const response = await fetch(`${baseUrl}/api/weather?city=%20`);
    assert.equal(response.status, 400);
});

test('limits requests per IP and returns retry headers after the limit', async () => {
    const rateLimitedServer = createServer({
        apiKey: 'test-key',
        rateLimitMax: 2,
        fetchImpl: async (url) => {
            const requestUrl = new URL(url);
            if (requestUrl.pathname.endsWith('/forecast')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        city: { timezone: 0 },
                        list: [{
                            dt: Date.now() / 1000,
                            main: { temp_min: 18, temp_max: 25 }
                        }]
                    })
                };
            }

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    name: 'Recife',
                    sys: { country: 'BR' },
                    main: { temp: 28, temp_max: 30, temp_min: 25, humidity: 70 },
                    weather: [{ description: 'nublado', icon: '03d' }],
                    wind: { speed: 5 }
                })
            };
        }
    });
    await new Promise((resolve) => rateLimitedServer.listen(0, '127.0.0.1', resolve));

    try {
        const baseUrlForLimitedServer = `http://127.0.0.1:${rateLimitedServer.address().port}`;
        await fetch(`${baseUrlForLimitedServer}/api/weather?city=Recife`);
        await fetch(`${baseUrlForLimitedServer}/api/weather?city=Maceio`);
        const blockedResponse = await fetch(`${baseUrlForLimitedServer}/api/weather?city=Aracaju`);
        const blockedData = await blockedResponse.json();

        assert.equal(blockedResponse.status, 429);
        assert.equal(blockedResponse.headers.get('x-ratelimit-limit'), '2');
        assert.equal(blockedResponse.headers.get('x-ratelimit-remaining'), '0');
        assert.ok(Number(blockedResponse.headers.get('retry-after')) > 0);
        assert.match(blockedData.error, /Limite de consultas/);
    } finally {
        await new Promise((resolve, reject) => {
            rateLimitedServer.close((error) => error ? reject(error) : resolve());
        });
    }
});

test('does not make the upstream request when the API key is missing', async () => {
    const missingKeyServer = createServer({
        apiKey: '',
        fetchImpl: async () => {
            throw new Error('fetch should not be called');
        }
    });
    await new Promise((resolve) => missingKeyServer.listen(0, '127.0.0.1', resolve));

    try {
        const response = await fetch(
            `http://127.0.0.1:${missingKeyServer.address().port}/api/weather?city=Recife`
        );
        assert.equal(response.status, 500);
    } finally {
        await new Promise((resolve, reject) => {
            missingKeyServer.close((error) => error ? reject(error) : resolve());
        });
    }
});
