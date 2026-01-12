import { 
    nightlyDigestStatsHandler, 
    processStats, 
    extractCurrent, 
    cacheResult,
    fetchNightlyDigestData,
    getConfig,
} from './index';
import { NightlyDigestExposure, NightlyDigestBaseResponse } from './types';
import {jest, test} from '@jest/globals';
import {mockedResponseSuccess} from './mockData';
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config';

jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls

const mockedAxios = axios as jest.Mocked<typeof axios>

const req = {
    query: {
        startDate: "20260106",
        endDate: "20270107"
    }
} as unknown as ff.Request;

const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
} as unknown as ff.Response;

describe('Nightly Digest stats', () => {
    const ENV = process.env;
    // const config = getConfig();
    let API_ENDPOINT: string;
    let CACHE_ENDPOINT: string;
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2026-01-07 01:30"));
        process.env = ENV;
        // const { API_ENDPOINT, CACHE_ENDPOINT } = getConfig().endpoints;
        API_ENDPOINT = getConfig().endpoints.API_ENDPOINT!;
        CACHE_ENDPOINT = getConfig().endpoints.CACHE_ENDPOINT!;
        jest.clearAllMocks();
    })
    afterEach(() => {
        jest.useRealTimers();
    })

    describe('fetchNightlyDigestData()', () => {
        it('propagates errors on API error', async () => {
            const mockError = new Error('Error');
            mockedAxios.get.mockRejectedValueOnce(mockError);

            await expect(fetchNightlyDigestData(API_ENDPOINT as string, '20260106', '20260107')).rejects.toThrow('Error');
        });

        it('should use default value for startDate and endDate', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {"success": true}
            })

            await fetchNightlyDigestData(API_ENDPOINT as string, '20260106', '20260107');
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': `Bearer ${process.env.BEARER_TOKEN}`
                    }),
                    params: expect.objectContaining({
                        dayObsStart: '20260106', 
                        dayObsEnd: '20260107',
                        instrument: 'LSSTCam'
                    })
                })
            );
        });
    })


    describe('nightlyDigestStatsHandler()', () => {
        const mockRes = () => {
            const res: any = {};
            res.status = jest.fn().mockReturnValue(res);
            res.send = jest.fn().mockReturnValue(res);
            res.json = jest.fn().mockReturnValue(res);
            return res;
        }
        it('routes /nightlydigest-stats to processStats', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess});

            const req = { 
                path: "/nightlydigest-stats", 
                query: {
                    startDate: "20260106", 
                    endDate: "20260107"
                }} as any;
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);

            expect(res.json).toHaveBeenCalled();

            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': `Bearer ${process.env.BEARER_TOKEN}`
                    }),
                    params: expect.objectContaining({
                        dayObsStart: '20260106', 
                        dayObsEnd: '20260107',
                        instrument: 'LSSTCam'
                    })
                })
            )
        });

        it('routes / to processStats', async () => {
            const req = { path: "/"} as any;
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);
            
            expect(res.send).toHaveBeenCalledWith("🐈‍⬛");
            expect(mockedAxios.get).not.toHaveBeenCalled();
        })

        it('returns 400 for unknown paths', async () => {
            const req = { path: '/unknown' } as any;
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
            await expect(processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string))
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
            const result = extractCurrent(mockData as any);

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
            const result = extractCurrent(mockData as any);

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
            const result = extractCurrent(mockData as any);

            expect(result.last_can_see_sky).toBeNull();
            expect(result.exposures_count).toBe(0);
        });
    })

    describe('processStats', () => {
        it('fetches data, extracts mode, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache

            const result = await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);

            expect(res.json).toHaveBeenCalled();
        })

        it('fetches data, extracts mode, caches result', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 }) // for redis cache
            const req = {
                query: {mode: "full_history"}
            } as unknown as ff.Request;

            const result = await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);

            expect(res.json).toHaveBeenCalled();
        })

        it('uses "current" as default mode when query.mode is missing', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValueOnce({ status: 200 });
            
            const req = { query: {} } as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
    
            const result = await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);
    
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'current' }) 
            );
        });

        it('missing req.query', async () => {
            mockedAxios.get.mockResolvedValue({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValue({ status: 200 });
        
            // req exists, but query is missing
            const req = {} as unknown as ff.Request;
            const res = { json: jest.fn() } as unknown as ff.Response;
    
            
            await expect(
                processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string)
            ).resolves.not.toThrow(); // don't throw an error because of the ?. operator
        
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'current' }) 
            );
        });

        it('uses the provided mode from query.mode', async () => {
            mockedAxios.get.mockResolvedValue({ data: mockedResponseSuccess });
            mockedAxios.post.mockResolvedValue({ status: 200 });
        
            const req = { query: { mode: 'full_history' } } as any;
            const res = { json: jest.fn() } as any;
        
            const result = await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);
        
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ params: 'full_history' }) 
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
    
            const result = await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);
    
            
            expect(res.json).toHaveBeenCalledWith({
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

            await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);

            expect(res.json).toHaveBeenCalledWith({
                dome_open: true,
                exposure_count: 0 // This is 0 since in extractCurrent(), we set exposures_count: exposuresCount ?? 0 where exposuresCount is undefined
            });
        });
    })
});