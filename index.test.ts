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
import * as ff from '@google-cloud/functions-framework';
import axios from 'axios';
import 'dotenv/config';

jest.mock('axios'); // mock axios globally at top level to prevent accidental network calls

const mockedAxios = axios as jest.Mocked<typeof axios>

// data fudged
const mockedResponseSuccess = {
    "exposures": [
        {
            "exposure_id": 2026010600002,
            "exposure_name": "blah",
            "exp_time": 5.0,
            "img_type": "dark",
            "observation_reason": "blah",
            "science_program": "BLOCK-blah",
            "target_name": "blah",
            "can_see_sky": false,
            "band": "y",
            "obs_start": "2026-01-06T20:07:11.814000",
            "physical_filter": "y_00001",
            "day_obs": 20260106,
            "seq_num": 2,
            "obs_end": "2026-01-06T20:07:16.830000",
            "overhead": 0.0,
            "zero_point_median": null,
            "visit_id": 1000001,
            "pixel_scale_median": null,
            "psf_sigma_median": null,
            "visit_gap": 0.0
        },
        {
            "exposure_id": 2026010600003,
            "exposure_name": "blah",
            "exp_time": 5.0,
            "img_type": "dark",
            "observation_reason": "blah",
            "science_program": "BLOCK-blah",
            "target_name": "blah",
            "can_see_sky": false,
            "band": "y",
            "obs_start": "2026-01-06T20:07:20.427000",
            "physical_filter": "y_00001",
            "day_obs": 20260106,
            "seq_num": 3,
            "obs_end": "2026-01-06T20:07:25.441000",
            "overhead": 3.00001,
            "zero_point_median": null,
            "visit_id": 1000002,
            "pixel_scale_median": null,
            "psf_sigma_median": null,
            "visit_gap": 3.00001
        }
    ],
    "exposures_count": 95,
    "sum_exposure_time": 2630.0,
    "on_sky_exposures_count": 89,
    "total_on_sky_exposure_time": 2600.0,
    "open_dome_times": [
        {
            "day_obs": 20260106,
            "open_time": "2026-01-07T00:13:55.615083",
            "close_time": "2026-01-07T03:47:13.284578",
            "open_hours": 3.00001
        }
    ]
}

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
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2026-01-07 01:30"));
        process.env = ENV;
    })
    afterEach(() => {
        jest.useRealTimers();
    })

    describe('env variables', () => {
        it('should use env vars if defined', () => {
            process.env.ND_CF_ENDPOINT = 'blah';
            process.env.ND_CACHE_ENDPOINT = 'blah'
            const cf_env = process.env.ND_CF_ENDPOINT || 'blah';
            const cache_env = process.env.ND_CACHE_ENDPOINT || 'blah';
            expect(cf_env).toBe('blah');
            expect(cache_env).toBe('blah');
        });

        it('should use correct defaults', () => {
            delete process.env.ND_CF_ENDPOINT;

            const config = getConfig();

            expect(config.endpoints.CF_ENDPOINT).toBe(
                "https://usdf-rsp-dev.slac.stanford.edu/nightlydigest/api/exposures"
            );
        })

    })

    describe('fetchNightlyDigestData()', () => {
        it('propagates errors on API error', async () => {
            const mockError = new Error('Error');
            mockedAxios.get.mockRejectedValueOnce(mockError);

            await expect(fetchNightlyDigestData("https://usdf-rsp-dev.slac.stanford.edu/nightlydigest/api/exposures", '20260106', '20260107')).rejects.toThrow('Error');
        });

        it('should use default value for startDate and endDate', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {"success": true}
            })

            await fetchNightlyDigestData("https://usdf-rsp-dev.slac.stanford.edu/nightlydigest/api/exposures", '20260106', '20260107');
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

            const req = { path: "/nightlydigest-stats", query: {startDate: "20260106", endDate: "20260107"}} as any;
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
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess});

            const req = { path: "/"} as any;
            const res = mockRes();

            await nightlyDigestStatsHandler(req, res);
            
            // check if correct endpoint
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.stringContaining(''),
                expect.any(Object)
            )
        })

        it('returns 400 for unknown paths', async () => {
            const req = { path: '/unknown' } as any;
            const res = mockRes();
    
            await nightlyDigestStatsHandler(req, res);
    
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('still returns if cache fails', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: mockedResponseSuccess });
            mockedAxios.post.mockRejectedValueOnce(new Error("Cache Down"));
            
            // suppress output during test and verify it was called
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(()=>{});
            await expect(processStats(req, res, '"https://usdf-rsp-dev.slac.stanford.edu/nightlydigest/api/exposures', 'https://us-west1-skyviewer.cloudfunctions.net/redis-client/nightly-digest-stats'))
                .resolves.not.toThrow();

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cache upload error: Cache Down"));
            consoleSpy.mockRestore();
        })
    })
});