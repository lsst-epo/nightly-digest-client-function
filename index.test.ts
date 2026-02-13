import { 
    nightlyDigestStatsHandler, 
    processStats, 
    extractCurrent, 
    fetchNightlyDigestData,
    reaccumulateExposures,
    bearerAuth,
    cacheResult
} from './index';
import {
    getFormattedDate,
    getConfig
} from './utils';
import { jest } from '@jest/globals';
import { mockedResponseSuccess } from './mockData';
import { NightlyDigestBaseResponse, Config } from './types';
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config';

jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls
import * as utils from './utils';

const mockedAxios = axios as jest.Mocked<typeof axios>

const req = {} as unknown as ff.Request;

const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
} as unknown as ff.Response;

const createMockConfig = (overrides = {}): Config => ({
    endpoints: { API_ENDPOINT: 'http://api', CACHE_ENDPOINT: 'http://cache' },
    tokens: { REDIS_CACHE_TOKEN: 'token', AUTH_TOKEN: 'auth' },
    params: { SURVEY_START_DATE: '20260101', MODE: 'current', DAY_OBS_START: '', DAY_OBS_END: '' },
    ...overrides
});

describe('Nightly Digest stats', () => {

    let config: Config;
    const ENV = process.env;
    let API_ENDPOINT: string;
    let CACHE_ENDPOINT: string;
    let REDIS_CACHE_TOKEN: string;
    let AUTH_TOKEN: string;

    let startDate: string;
    let endDate: string;
    let mode: string;
    beforeEach(() => {
        const now = new Date(Date.UTC(2026, 1, 9, 1, 30, 0)); // just set a fixed point in time so that this suite is reproducible
        jest.useFakeTimers().setSystemTime(now);

        jest.spyOn(utils, 'getConfig').mockReturnValue(createMockConfig()); // replaces actual getConfig in utils with this mocked one.

        config = getConfig();
        API_ENDPOINT = config.endpoints.API_ENDPOINT!;
        CACHE_ENDPOINT = config.endpoints.CACHE_ENDPOINT!;
        REDIS_CACHE_TOKEN = config.tokens.REDIS_CACHE_TOKEN as string;
        AUTH_TOKEN = config.tokens.AUTH_TOKEN as string;

        const {DAY_OBS_START, DAY_OBS_END, MODE } = config.params;
        startDate = getFormattedDate();
        endDate = getFormattedDate(1);

        mode = (MODE ?? req.query?.mode ?? 'current') as string; // probably don't need this right now, but could be useful in the future if we want to expand beyond just getting current
        jest.clearAllMocks();
    })
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        mockedAxios.get.mockReset();
        mockedAxios.post.mockReset();
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
            const testStart = '20260208';
            const testEnd = '20260209';

            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });

            const req = { 
                path: "/nightly-digest-stats", 
                headers: { authorization: `Bearer ${AUTH_TOKEN}` },
                query: {
                    startDate: testStart,
                    endDate: testEnd
                }
            } as unknown as ff.Request;
            
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({
                        dayObsStart: testStart, 
                        dayObsEnd: testEnd,
                        instrument: 'LSSTCam'
                    })
                })
            );
        });

        it('routes /nightly-digest-stats to reaccumulateExposures if overrideRunDate is set and calls api once', async () => {
            const testStart = '20260101';
            const testEnd = '20260103';

            mockedAxios.get.mockReset(); 
            mockedAxios.post.mockReset();
            mockedAxios.get
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 5 } })
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 10 } });
            mockedAxios.post.mockResolvedValue({ status: 200 });

            const req = { 
                path: "/nightly-digest-stats", 
                headers: { authorization: `Bearer ${AUTH_TOKEN}` },
                query: {
                    startDate: testStart,
                    endDate: testEnd, 
                    overrideRunDate: 'true'
                }
            } as unknown as ff.Request;
            
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({
                        dayObsStart: testStart, 
                        instrument: 'LSSTCam'
                    })
                })
            );

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ exposure_count: 5 }) // we only want the first mock since 30 day range is the one sent by /night-digest-stats
            );

            expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        });


        it('routes /nightly-digest-stats to reaccumulateExposures if overrideRunDate is set and calls api twice', async () => {
            const testStart = '20260101';
            const testEnd = '20260203';

            mockedAxios.get.mockReset(); 
            mockedAxios.post.mockReset();
            mockedAxios.get
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 5 } })
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 10 } });
            mockedAxios.post.mockResolvedValue({ status: 200 });

            const req = { 
                path: "/nightly-digest-stats", 
                headers: { authorization: `Bearer ${AUTH_TOKEN}` },
                query: {
                    startDate: testStart,
                    endDate: testEnd, 
                    overrideRunDate: 'true'
                }
            } as unknown as ff.Request;
            
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({
                        dayObsStart: testStart, 
                        instrument: 'LSSTCam'
                    })
                })
            );

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ exposure_count: 15 }) // we want both mocks since we now have a date range of larger than 30 days
            );

            expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        });

        it('routes / to processStats', async () => {
            const req = { path: "/", headers: { authorization: `Bearer ${AUTH_TOKEN}` } } as unknown as ff.Request;
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);
            
            expect(res.send).toHaveBeenCalledWith("🐈‍⬛");
            expect(mockedAxios.get).not.toHaveBeenCalled();
        })

        it('returns 400 for unknown paths', async () => {
            const req = { path: '/unknown',  headers: { authorization: `Bearer ${AUTH_TOKEN}` } } as unknown as ff.Request;
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

            await expect(processStats(config, startDate, endDate, mode))
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
            const result = await processStats(config,  '20260129', '20260130', 'current')

            expect(result).toHaveProperty('exposure_count');
            expect(mockedAxios.post).toHaveBeenCalled();
        })

        it('fetches data, extracts mode, caches result with full history', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache
            const req = {
                query: {mode: "full_history"}
            } as unknown as ff.Request;

            await processStats(config, '20260129', '20260130', 'full_history');
        
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'full_history' }), 
                expect.any(Object)
            );
        })

        it('uses "current" as default mode when query.mode is missing', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 });
            
            const req = { query: {} } as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
    
            await processStats(config, startDate, endDate, mode);
    
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
                processStats(config, startDate, endDate, mode)
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
        
            await processStats(config, startDate, endDate, 'full_history');
        
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
    
            const result = await processStats(config, startDate, endDate, mode);

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

            const result = await processStats(config, startDate, endDate, mode);

            expect(result).toEqual({
                dome_open: true,
                exposure_count: 0
            });
        });

        it('returns 0 for exposure_count when data is missing', async () => {
            const exposureMissingData = {
                exposures: [],
                exposures_count: undefined 
            };
        
            mockedAxios.get.mockResolvedValueOnce({ data: exposureMissingData });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 });
        
            const result = await processStats(config, '20260101', '20260103', 'current');
        
            // 0 because extractCurrent defaults it
            expect(result.exposure_count).toBe(0); 
        });
    })

    describe('reaccumulateExposures()', () => {
        it('iterates through each day and accumulates exposure counts', async () => {
            // Mock 3 days of data
            mockedAxios.get
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 10 } }) // Day 1
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 20 } }) // Day 2
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 30 } }); // Day 3
            
            mockedAxios.post.mockResolvedValue({ status: 200 });
    
            const start = "20260101";
            const end = "20260104"; // Loop runs for 01, 02, 03
    
            const result = await reaccumulateExposures(config, start, end);
    
            // Verification
            expect(mockedAxios.get).toHaveBeenCalledTimes(3);
            expect(result.exposure_count).toBe(60); // 10 + 20 + 30
            
            // Verify last call dates
            expect(mockedAxios.get).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    params: expect.objectContaining({ dayObsStart: "20260103", dayObsEnd: "20260104" })
                })
            );
        });
    
        it('handles date range of 0 correctly', async () => {
            const start = "20260101";
            const end = "20260101"; // Start is not less than end
    
            const result = await reaccumulateExposures(config, start, end);
    
            expect(mockedAxios.get).not.toHaveBeenCalled();
            expect(result.exposure_count).toBe(0);
        });

        it('logs an error and continues when one day in the loop fails', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            
            mockedAxios.get
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 10 } }) // Day 1
                .mockRejectedValueOnce(new Error("API Timeout"))                       // Day 2 (Failure)
                .mockResolvedValueOnce({ data: { exposures: [], exposures_count: 5 } });  // Day 3
            
            mockedAxios.post.mockResolvedValue({ status: 200 });
        
            const start = "20260101";
            const end = "20260104";
        
            const result = await reaccumulateExposures(config, start, end);
        
            // The loop should have attempted all 3 days despite the failure on day 2
            expect(mockedAxios.get).toHaveBeenCalledTimes(3);
        
            // The result should only contain the sum of the successful days (10 + 5)
            expect(result.exposure_count).toBe(15);
        
            // Check that console.error was called for the specific day that failed
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Error on 20260102"), // The day that failed
                expect.any(Error)
            );
        
            consoleSpy.mockRestore();
        });
    });
});


describe('nightlyDigestStatsHandler parameter resolution', () => {
    const mockAuthToken = 'test-token';
    
    const getBaseReq = (query = {}) => ({
        path: "/nightly-digest-stats",
        headers: { authorization: `Bearer ${mockAuthToken}` },
        query
    } as unknown as ff.Request);

    it('prioritizes config.params over req.query', async () => {
        jest.spyOn(utils, 'getConfig').mockReturnValue({
            params: { 
                MODE: 'current',
                SURVEY_START_DATE: '20260101',
                DAY_OBS_START: '',
                DAY_OBS_END: ''
            },
            tokens: { AUTH_TOKEN: mockAuthToken, REDIS_CACHE_TOKEN: 'token' },
            endpoints: { API_ENDPOINT: 'http://api', CACHE_ENDPOINT: 'http://cache' }
        });

        mockedAxios.get.mockResolvedValue({ data: mockedResponseSuccess });
        const req = getBaseReq({ mode: 'query-mode' });
        const res = { 
            json: jest.fn(),
            res: jest.fn(),
            req: jest.fn()
        } as any;

        await nightlyDigestStatsHandler(req, res);

        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                params: 'current'
            }),
            expect.any(Object)
        );
    });

    it('uses defaults when both config and query are missing', async () => {
        mockedAxios.get.mockClear();
        mockedAxios.get.mockResolvedValue({ data: mockedResponseSuccess });

        jest.spyOn(utils, 'getConfig').mockReturnValue({
            params: { SURVEY_START_DATE: '20260101', MODE: '', DAY_OBS_START: '', DAY_OBS_END: '' },
            tokens: { AUTH_TOKEN: mockAuthToken, REDIS_CACHE_TOKEN: 'token' },
            endpoints: { API_ENDPOINT: 'http://api', CACHE_ENDPOINT: 'http://cache' }
        });

        const req = getBaseReq({}); // Empty query
        const res = { 
            json: jest.fn(),
            res: jest.fn(),
            req: jest.fn()
        } as any;

        await nightlyDigestStatsHandler(req, res);

        expect(mockedAxios.get).toHaveBeenCalledTimes(1); 
        expect(mockedAxios.get).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                params: expect.objectContaining({
                    dayObsStart: getFormattedDate(-1), // Yesterday
                    dayObsEnd: getFormattedDate()   // Today
                })
            })
        );
    });

    it('cacheResult: handles non-Error objects in catch block', async () => {
        const config = createMockConfig();
        const stringError = "Internal Server Error"; // A string, not an Error object
        mockedAxios.post.mockRejectedValueOnce(stringError);
        
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
        const result = await cacheResult(config, 'current', { dome_open: true, exposure_count: 5 });
    
        // expect the 'String(error)' branch to be hit
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining(`Cache upload error: ${stringError}`)
        );
        expect(result).toBeNull();
    
        consoleSpy.mockRestore();
    });
});

describe('bearerAuth()', () => {
    const AUTH_TOKEN = 'token';
    let mockReq: any;
    let mockRes: any;
    let next: jest.Mock;

    beforeEach(() => {
        next = jest.fn();
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    });

    it('returns 401 if Authorization header is missing', () => {
        mockReq = { headers: {} }; // No authorization header

        bearerAuth(mockReq, mockRes, next, AUTH_TOKEN);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized: Missing Bearer Token" });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 if Authorization header does not start with Bearer', () => {
        mockReq = { 
            headers: { authorization: 'Basic blah' } 
        };

        bearerAuth(mockReq, mockRes, next, AUTH_TOKEN);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized: Missing Bearer Token" });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 if token does not match authToken', () => {
        mockReq = { 
            headers: { authorization: 'Bearer blah' } // 'blah' is not 'token'
        };

        bearerAuth(mockReq, mockRes, next, AUTH_TOKEN);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: "Unauthorized: Invalid Token" });
        expect(next).not.toHaveBeenCalled();
    });

    it('calls next() if token is valid', () => {
        mockReq = { 
            headers: { authorization: `Bearer ${AUTH_TOKEN}` } 
        };

        bearerAuth(mockReq, mockRes, next, AUTH_TOKEN);

        expect(next).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
    });
});

