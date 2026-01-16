import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import axios from "axios";
import { NightlyDigestBaseResponse, NightlyDigestParams, CleanedNightlyStats } from './types';
import { NextFunction } from 'express';

export const getConfig = () => {
    return {
        endpoints: {
            API_ENDPOINT: process.env.NIGHTLY_DIGEST_API_ENDPOINT,
            CACHE_ENDPOINT: process.env.NIGHTLY_DIGEST_CACHE_ENDPOINT
        },
        tokens: {
            REDIS_CACHE_TOKEN: process.env.REDIS_CACHE_TOKEN,
            AUTH_TOKEN: process.env.AUTH_TOKEN

        }
        
    };
};

const { API_ENDPOINT, CACHE_ENDPOINT } = getConfig().endpoints;
const { REDIS_CACHE_TOKEN, AUTH_TOKEN }  = getConfig().tokens;

export async function cacheResult(endpoint: string, cache_endpoint: string, params: string | NightlyDigestParams, data: CleanedNightlyStats | NightlyDigestBaseResponse) {
    try {
        const payload = { endpoint: endpoint, params: params, data: data }
        await axios.post(
            cache_endpoint, 
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${REDIS_CACHE_TOKEN}`
                }
            }
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Cache upload error: ${message}`)
    }
}

// get last exposure along with exposure_count
export function extractCurrent(data: NightlyDigestBaseResponse) {
    const { exposures, exposures_count: exposuresCount } = data;

    const lastExposure = exposures.length > 0 ? exposures[exposures.length - 1] : null;

    return {
        last_exposure: lastExposure,
        last_can_see_sky: lastExposure?.can_see_sky ?? null,
        exposures_count: exposuresCount ?? 0
    }
}

export async function fetchNightlyDigestData<T>(endpoint: string, startDate: string, endDate: string): Promise<T> {
    const bearerToken = process.env.NIGHTLY_DIGEST_API_TOKEN
    const instrument = "LSSTCam"

    try {
        const response = await axios.get(endpoint, {
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
            },
            params: {
                instrument: instrument,
                dayObsStart: startDate,
                dayObsEnd: endDate
            }
        })

        return response.data;
    } catch (error) {
        console.error(error);
        throw error;
    }
}


export async function processStats(req: ff.Request, res: ff.Response, cloudEndpoint: string, cacheEndpoint: string) {
    const mode = (req.query?.mode || 'current') as string; // probably don't need this right now, but could be useful in the future if we want to expand beyond just getting current
    const startDate = req.query?.startDate as string
    const endDate = req.query?.endDate as string 
    const data = await fetchNightlyDigestData<NightlyDigestBaseResponse>(cloudEndpoint, startDate, endDate);

    const currentData = extractCurrent(data);

    const cleaned_result = {
        dome_open: currentData.last_can_see_sky ?? null,
        exposure_count: currentData.exposures_count ?? null
    } as CleanedNightlyStats;

    await cacheResult(cloudEndpoint, cacheEndpoint, mode, cleaned_result); 
    res.json(cleaned_result)
}


export function bearerAuth(req: ff.Request, res: ff.Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({error: "Unauthorized: Missing Bearer Token"});
    }

    const token = authHeader.split(' ')[1];

    if (token !== AUTH_TOKEN as string) {
        return res.status(401).json({error: "Unauthorized: Invalid Token"});
    }

    return next();
}

export async function nightlyDigestStatsHandler (req: ff.Request, res: ff.Response) {
    if (req.path == "/") {
        return res.status(200).send("🐈‍⬛"); 
    } else if (req.path == "/nightly-digest-stats") {
        return bearerAuth(
            req,
            res, 
            async () => {
                return await processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string)
            });
    } else {
        return res.status(400).send("Oopsies.");
    }
}

ff.http("nightlydigest-stats", nightlyDigestStatsHandler);