import { 
    nightlyDigestStatsHandler, 
    processStats, 
    extractCurrent, 
    fetchNightlyDigestData
} from './index';
import {
    getFormattedDate,
    getConfig
} from './utils';
import {jest} from '@jest/globals';
import {mockedResponseSuccess} from './mockData';
import { NightlyDigestBaseResponse } from './types';
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config';

jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls

const mockedAxios = axios as jest.Mocked<typeof axios>

const req = {} as unknown as ff.Request;

const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
} as unknown as ff.Response;

describe('Nightly Digest stats', () => {
    const ENV = process.env;
    let API_ENDPOINT: string;
    let CACHE_ENDPOINT: string;
    let REDIS_CACHE_TOKEN: string;
    let AUTH_TOKEN: string;

    let startDate: string;
    let endDate: string;
    let mode: string;
    beforeEach(() => {
        const now = new Date();
        now.setHours(1, 30, 0, 0); // 1:30 am
        jest.useFakeTimers().setSystemTime(now);

        const config = getConfig();
        API_ENDPOINT = config.endpoints.API_ENDPOINT!;
        CACHE_ENDPOINT = config.endpoints.CACHE_ENDPOINT!;
        REDIS_CACHE_TOKEN = config.tokens.REDIS_CACHE_TOKEN as string;
        AUTH_TOKEN = config.tokens.AUTH_TOKEN as string;

        const {DAY_OBS_START, DAY_OBS_END, MODE, TOTAL_EXPECTED_EXPOSURES } = config.params;
        startDate = getFormattedDate();
        endDate = getFormattedDate(1);

        mode = (MODE ?? req.query?.mode ?? 'current') as string; // probably don't need this right now, but could be useful in the future if we want to expand beyond just getting current
        jest.clearAllMocks();
    })
    afterEach(() => {
        jest.useRealTimers();
    })

    describe('fetchNightlyDigestData()', () => {
        it('propagates errors on API error', async () => {
            const mockError = new Error('Error');
            console.error = jest.fn(); // silence error
            mockedAxios.get.mockRejectedValueOnce(mockError);

            await expect(fetchNightlyDigestData(API_ENDPOINT as string, getFormattedDate(), getFormattedDate(1))).rejects.toThrow('Error');
        });

        it('should use default value for startDate and endDate', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {"success": true}
            })

            await fetchNightlyDigestData(API_ENDPOINT as string, getFormattedDate(), getFormattedDate(1));
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': `Bearer ${process.env.NIGHTLY_DIGEST_API_TOKEN}`
                    }),
                    params: expect.objectContaining({
                        dayObsStart: getFormattedDate(), 
                        dayObsEnd: getFormattedDate(1),
                        instrument: 'LSSTCam'
                    })
                })
            );
        });
    })


    describe('nightlyDigestStatsHandler()', () => {
        const mockRes = () => {
            const res = {
                status: jest.fn().mockReturnThis(),
                send: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            } as unknown as ff.Response;
            return res;
        }
        it('routes /nightly-digest-stats to processStats', async () => {
            const start = process.env.DAY_OBS_START;
            const end = getFormattedDate();
            const now = new Date();
            now.setHours(1, 30, 0, 0); // 1:30 am
            jest.useFakeTimers().setSystemTime(now);
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess});

            const req = { 
                path: "/nightly-digest-stats", 
                headers: {
                    authorization: `Bearer ${AUTH_TOKEN}`
                },
                query: {
                    startDate: start, 
                    endDate: end
                }} as unknown as ff.Request;
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);

            expect(res.json).toHaveBeenCalled();

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': `Bearer ${process.env.NIGHTLY_DIGEST_API_TOKEN}`
                    }),
                    params: expect.objectContaining({
                        dayObsStart: start ?? getFormattedDate(-1), 
                        dayObsEnd: end,
                        instrument: 'LSSTCam'
                    })
                })
            )
        });

        it('routes / to processStats', async () => {
            const req = { path: "/"} as unknown as ff.Request;
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);
            
            expect(res.send).toHaveBeenCalledWith("🐈‍⬛");
            expect(mockedAxios.get).not.toHaveBeenCalled();
        })

        it('returns 400 for unknown paths', async () => {
            const req = { path: '/unknown' } as unknown as ff.Request;
            const res = mockRes();
    
            await nightlyDigestStatsHandler(req, res);
    
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.send).toHaveBeenCalledWith("Oopsies.");
        });

        it('still returns if cache fails', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockRejectedValueOnce(new Error("Cache Down"));
            
            // suppress output during test and verify it was called
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(()=>{});
            await expect(processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, mode))
                .resolves.not.toThrow();

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cache upload error: Cache Down"));
            consoleSpy.mockRestore();
        })
    })

    describe('extractCurrent()', () => {
        // exposures.length > 0
        it('should return null for last_exposure if exposures array is empty', () => {
            const mockData = { 
                exposures: [], 
                exposures_count: 0 
            };
            const result = extractCurrent(mockData as NightlyDigestBaseResponse);

            expect(result.last_exposure).toBeNull();
            expect(result.last_can_see_sky).toBeNull();
        });

        //  exposures[exposures.length - 1]
        it('should return the very last item in the exposures array', () => {
            const mockData = {
                exposures: [
                    { can_see_sky: false, id: 1 },
                    { can_see_sky: true, id: 2 }
                ],
                exposures_count: 2
            };
            const result = extractCurrent(mockData as unknown as NightlyDigestBaseResponse);

            expect(result.last_exposure).toEqual({ can_see_sky: true, id: 2 });
            expect(result.last_can_see_sky).toBe(true);
            expect(result.exposures_count).toBe(2);
        });

        it('should fallback to defaults when properties are missing', () => {
            const mockData = { 
                exposures: [
                    { 
                        id: 1 
                    }
                ], // can_see_sky missing
                exposures_count: undefined 
            };
            const result = extractCurrent(mockData as unknown as NightlyDigestBaseResponse);

            expect(result.last_can_see_sky).toBeNull();
            expect(result.exposures_count).toBe(0);
        });
    })

    describe('processStats', () => {
        it('fetches data, extracts mode, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache
            const result = await processStats(API_ENDPOINT, CACHE_ENDPOINT, '20260129', '20260130', 'current');

            expect(result).toHaveProperty('exposure_count');
            expect(mockedAxios.post).toHaveBeenCalled();
        })

        it('fetches data, extracts mode, caches result with full history', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache
            const req = {
                query: {mode: "full_history"}
            } as unknown as ff.Request;

            await processStats(API_ENDPOINT, CACHE_ENDPOINT, '20260129', '20260130', 'full_history');
        
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'full_history' }), // This will now pass
                expect.any(Object)
            );
        })

        it('uses "current" as default mode when query.mode is missing', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 });
            
            const req = { query: {} } as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
    
            await processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, mode);
    
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'current' }),
                expect.objectContaining({
                    headers: {
                        'Authorization': `Bearer ${REDIS_CACHE_TOKEN}`
                    }
                })
            );
        });

        it('missing req.query', async () => {
            mockedAxios.get.mockResolvedValue({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValue({ status: 200 });
        
            // req exists, but query is missing
            const req = {} as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
    
            
            await expect(
                processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, mode)
            ).resolves.not.toThrow(); // don't throw an error because of the ?. operator
        
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'current' }),
                expect.objectContaining({
                    headers: {
                        'Authorization': `Bearer ${REDIS_CACHE_TOKEN}`
                    }
                })
            );
        });

        it('uses the provided mode from query.mode', async () => {
            mockedAxios.get.mockResolvedValue({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValue({ status: 200 });
        
            const req = { query: { mode: 'full_history' } } as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
        
            await processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, 'full_history');
        
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'full_history' }),
                expect.objectContaining({
                    headers: {
                        'Authorization': `Bearer ${REDIS_CACHE_TOKEN}`
                    }
                })
            );
        });
    
        it('maps can_see_sky false to null for dome_open', async () => {
            const dataWithFalseSky = {
                exposures: [{ can_see_sky: false }],
                exposures_count: 95
            };
            mockedAxios.get.mockResolvedValueOnce({ data: dataWithFalseSky });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 });
    
            const req = { query: { mode: 'current' } } as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
    
            const result = await processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, mode);

            expect(result).toEqual({
                dome_open: false,
                exposure_count: 95
            });
        });
    
        it('handles missing exposures_count by returning 0', async () => {
            const dataMissingCount = {
                exposures: [{ can_see_sky: true }],
                exposures_count: undefined 
            };

            mockedAxios.get.mockResolvedValueOnce({ data: dataMissingCount });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 });

            const req = { query: { mode: 'current' } } as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;

            const result = await processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, mode);

            expect(result).toEqual({
                dome_open: true,
                exposure_count: 0
            });
        });
    })
});