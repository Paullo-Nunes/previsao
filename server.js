import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OPENWEATHER_CURRENT_URL = 'https://api.openweathermap.org/data/2.5/weather';
const OPENWEATHER_FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CITY_LENGTH = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const MAX_RATE_LIMIT_ENTRIES = 10000;
const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_WEATHER_CACHE_ENTRIES = 500;
const PUBLIC_ROOT_FILES = new Set(['index.html', 'script.js', 'style.css']);
const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https://openweathermap.org https://*.openweathermap.org",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "script-src 'self'",
    "connect-src 'self'"
].join('; ');

function sendJson(res, statusCode, body) {
    res.writeHead(statusCode, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(body));
}

function consumeRateLimit(rateLimits, ip, now, maxRequests, windowMs) {
    let entry = rateLimits.get(ip);

    if (!entry || entry.resetAt <= now) {
        if (rateLimits.size >= MAX_RATE_LIMIT_ENTRIES) {
            for (const [key, value] of rateLimits) {
                if (value.resetAt <= now) {
                    rateLimits.delete(key);
                }
            }
        }

        if (rateLimits.size >= MAX_RATE_LIMIT_ENTRIES) {
            const earliestReset = Math.min(...Array.from(rateLimits.values(), (value) => value.resetAt));
            return { allowed: false, remaining: 0, resetAt: earliestReset };
        }

        entry = { count: 0, resetAt: now + windowMs };
        rateLimits.set(ip, entry);
    }

    if (entry.count >= maxRequests) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return {
        allowed: true,
        remaining: maxRequests - entry.count,
        resetAt: entry.resetAt
    };
}

function getCachedWeather(cache, cityKey, now) {
    const entry = cache.get(cityKey);
    if (!entry) {
        return null;
    }

    if (entry.expiresAt <= now) {
        cache.delete(cityKey);
        return null;
    }

    cache.delete(cityKey);
    cache.set(cityKey, entry);
    return entry.data;
}

function cacheWeather(cache, cityKey, data, now, ttlMs) {
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) {
            cache.delete(key);
        }
    }

    if (cache.has(cityKey)) {
        cache.delete(cityKey);
    } else if (cache.size >= MAX_WEATHER_CACHE_ENTRIES) {
        cache.delete(cache.keys().next().value);
    }

    cache.set(cityKey, { data, expiresAt: now + ttlMs });
}

function isValidWeather(weather) {
    const condition = weather?.weather?.[0];
    return typeof weather?.name === 'string'
        && typeof weather?.sys?.country === 'string'
        && Number.isFinite(weather?.main?.temp)
        && Number.isFinite(weather?.main?.temp_max)
        && Number.isFinite(weather?.main?.temp_min)
        && Number.isFinite(weather?.main?.humidity)
        && typeof condition?.description === 'string'
        && /^\d{2}[dn]$/.test(condition?.icon || '')
        && Number.isFinite(weather?.wind?.speed);
}

function isValidForecast(forecast) {
    return Number.isFinite(forecast?.city?.timezone)
        && Array.isArray(forecast?.list)
        && forecast.list.length > 0
        && forecast.list.every((item) =>
            Number.isFinite(item?.dt)
            && Number.isFinite(item?.main?.temp_min)
            && Number.isFinite(item?.main?.temp_max)
        );
}

function getDailyForecast(forecast, now) {
    const timezoneOffset = forecast.city.timezone;
    const today = new Date(now() + timezoneOffset * 1000).toISOString().slice(0, 10);
    const days = new Map();

    for (const item of forecast.list) {
        const date = new Date((item.dt + timezoneOffset) * 1000).toISOString().slice(0, 10);
        const day = days.get(date) || { temperatureMin: Infinity, temperatureMax: -Infinity };
        day.temperatureMin = Math.min(day.temperatureMin, item.main.temp_min);
        day.temperatureMax = Math.max(day.temperatureMax, item.main.temp_max);
        days.set(date, day);
    }

    const date = days.has(today) ? today : [...days.keys()].sort()[0];
    return date ? { date, ...days.get(date) } : null;
}

async function handleWeather(
    req,
    res,
    requestUrl,
    apiKey,
    fetchImpl,
    now,
    rateLimits,
    weatherCache,
    rateLimitMax,
    rateLimitWindowMs,
    cacheTtlMs
) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { error: 'Método não permitido.' });
    }

    const rateLimit = consumeRateLimit(
        rateLimits,
        req.socket.remoteAddress || 'unknown',
        now(),
        rateLimitMax,
        rateLimitWindowMs
    );
    res.setHeader('X-RateLimit-Limit', String(rateLimitMax));
    res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimit.resetAt / 1000)));

    if (!rateLimit.allowed) {
        const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - now()) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        return sendJson(res, 429, { error: 'Limite de consultas atingido. Tente novamente em instantes.' });
    }

    const city = requestUrl.searchParams.get('city')?.trim() || '';
    if (!city || city.length > MAX_CITY_LENGTH) {
        return sendJson(res, 400, { error: 'Informe uma cidade válida.' });
    }

    if (!apiKey) {
        console.error('Missing OPENWEATHER_API_KEY environment variable.');
        return sendJson(res, 500, { error: 'Serviço de previsão indisponível.' });
    }

    const cityKey = city.normalize('NFKC').toLocaleLowerCase('pt-BR');
    const cachedWeather = getCachedWeather(weatherCache, cityKey, now());
    if (cachedWeather) {
        res.setHeader('X-Weather-Cache', 'HIT');
        return sendJson(res, 200, cachedWeather);
    }
    res.setHeader('X-Weather-Cache', 'MISS');

    function buildUrl(endpoint) {
        const url = new URL(endpoint);
        url.searchParams.set('q', city);
        url.searchParams.set('appid', apiKey);
        url.searchParams.set('units', 'metric');
        url.searchParams.set('lang', 'pt_br');
        return url;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const requestOptions = {
            headers: { Accept: 'application/json' },
            signal: controller.signal
        };
        const [currentResponse, forecastResponse] = await Promise.all([
            fetchImpl(buildUrl(OPENWEATHER_CURRENT_URL), requestOptions),
            fetchImpl(buildUrl(OPENWEATHER_FORECAST_URL), requestOptions)
        ]);

        if (currentResponse.status === 404 || forecastResponse.status === 404) {
            return sendJson(res, 404, { error: 'Cidade não encontrada.' });
        }

        if (!currentResponse.ok || !forecastResponse.ok) {
            console.error(
                `OpenWeather returned HTTP ${currentResponse.status}/${forecastResponse.status}.`
            );
            return sendJson(res, 502, { error: 'Não foi possível obter a previsão.' });
        }

        const [weather, forecast] = await Promise.all([
            currentResponse.json(),
            forecastResponse.json()
        ]);
        if (!isValidWeather(weather) || !isValidForecast(forecast)) {
            console.error('OpenWeather returned an unexpected response shape.');
            return sendJson(res, 502, { error: 'Resposta inválida do serviço de previsão.' });
        }

        const dailyForecast = getDailyForecast(forecast, now);
        if (!dailyForecast) {
            return sendJson(res, 502, { error: 'Previsão diária indisponível.' });
        }

        const result = {
            city: weather.name,
            country: weather.sys.country,
            temperature: weather.main.temp,
            temperatureMax: dailyForecast.temperatureMax,
            temperatureMin: dailyForecast.temperatureMin,
            forecastDate: dailyForecast.date,
            humidity: weather.main.humidity,
            description: weather.weather[0].description,
            icon: weather.weather[0].icon,
            windSpeedKmh: weather.wind.speed * 3.6
        };
        cacheWeather(weatherCache, cityKey, result, now(), cacheTtlMs);
        return sendJson(res, 200, result);
    } catch (error) {
        if (error.name === 'AbortError') {
            return sendJson(res, 504, { error: 'O serviço de previsão demorou para responder.' });
        }

        console.error(
            'OpenWeather request failed:',
            error instanceof Error ? error.name : 'Unknown error'
        );
        return sendJson(res, 502, { error: 'Não foi possível obter a previsão.' });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function serveStaticFile(req, res, pathname) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        res.writeHead(400);
        return res.end();
    }

    const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
    const pathSegments = relativePath.split(/[\\/]+/);
    const isPublicRootFile = pathSegments.length === 1
        && PUBLIC_ROOT_FILES.has(pathSegments[0]);
    const isImageAsset = pathSegments.length > 1
        && pathSegments[0] === 'images';

    if (
        pathSegments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))
        || (!isPublicRootFile && !isImageAsset)
    ) {
        res.writeHead(404);
        return res.end();
    }

    const filePath = path.resolve(ROOT, relativePath);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
        res.writeHead(404);
        return res.end();
    }

    try {
        const content = await fs.readFile(filePath);
        const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
        if (!contentType) {
            res.writeHead(404);
            return res.end();
        }

        res.writeHead(200, {
            'Cache-Control': 'no-cache',
            'Content-Length': content.length,
            'Content-Type': contentType
        });
        return res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
            res.writeHead(404);
            return res.end();
        }
        throw error;
    }
}

function createServer({
    apiKey = process.env.OPENWEATHER_API_KEY,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    rateLimitMax = RATE_LIMIT_MAX_REQUESTS,
    rateLimitWindowMs = RATE_LIMIT_WINDOW_MS,
    cacheTtlMs = WEATHER_CACHE_TTL_MS
} = {}) {
    const rateLimits = new Map();
    const weatherCache = new Map();

    return http.createServer((req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);

        let requestUrl;
        try {
            requestUrl = new URL(req.url, 'http://localhost');
        } catch {
            res.writeHead(400);
            return res.end();
        }

        if (requestUrl.pathname === '/api/weather') {
            handleWeather(
                req,
                res,
                requestUrl,
                apiKey,
                fetchImpl,
                now,
                rateLimits,
                weatherCache,
                rateLimitMax,
                rateLimitWindowMs,
                cacheTtlMs
            )
                .catch((error) => {
                    console.error('Weather endpoint failed:', error);
                    if (!res.headersSent) {
                        sendJson(res, 500, { error: 'Erro interno do servidor.' });
                    } else {
                        res.destroy(error);
                    }
                });
            return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('Allow', 'GET, HEAD');
            res.writeHead(405);
            return res.end();
        }

        serveStaticFile(req, res, requestUrl.pathname).catch((error) => {
            console.error('Static file request failed:', error);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end();
            } else {
                res.destroy(error);
            }
        });
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT) || 3000;
    createServer().listen(port, () => {
        console.log(`Previsão do tempo disponível em http://localhost:${port}`);
    });
}

export { createServer };
