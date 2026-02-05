import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import axios from "axios";
import { NightlyDigestBaseResponse, NightlyDigestParams, CleanedNightlyStats } from './types';
import { NextFunction } from 'express';
import { getConfig, getFormattedDate, isNextDay} from './utils';


const { API_ENDPOINT, CACHE_ENDPOINT } = getConfig().endpoints;
const { REDIS_CACHE_TOKEN, AUTH_TOKEN }  = getConfig().tokens;
const { DAY_OBS_START, DAY_OBS_END, MODE, TOTAL_EXPECTED_EXPOSURES } = getConfig().params;

export async function cacheResult(endpoint: string, cache_endpoint: string, params: string | NightlyDigestParams, data: CleanedNightlyStats | NightlyDigestBaseResponse, startDate?: string) {
    try {
        const payload = { endpoint: endpoint, params: params, data: data, startDate: startDate }
        const response = await axios.post(
            cache_endpoint, 
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${REDIS_CACHE_TOKEN}`
                }
            }
        )

        return response?.data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Cache upload error: ${message}`)
        return null;
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

    console.log(`startDate: ${startDate}, endDate: ${endDate}`);

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


export async function processStats(cloudEndpoint: string, cacheEndpoint: string, startDate: string, endDate: string, mode: string) {
    const data = await fetchNightlyDigestData<NightlyDigestBaseResponse>(cloudEndpoint, startDate, endDate);
    const currentData = extractCurrent(data);

    const cleanedResult = {
        dome_open: currentData.last_can_see_sky ?? null,
        exposure_count: currentData.exposures_count ?? null
    } as CleanedNightlyStats;

    const bucketDate = isNextDay(startDate, endDate) ? startDate : undefined;
    await cacheResult(cloudEndpoint, cacheEndpoint, mode, cleanedResult, bucketDate); 
    return cleanedResult;

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
                const mode = (MODE ?? req.query?.mode ?? 'current') as string; // probably don't need this right now, but could be useful in the future if we want to expand beyond just getting current
                const startDate = (DAY_OBS_START ?? req.query?.startDate ?? getFormattedDate(-1) ) as string
                const endDate = (DAY_OBS_END ?? req.query?.endDate ?? getFormattedDate()) as string 
                let result = await processStats(API_ENDPOINT as string, CACHE_ENDPOINT as string, startDate, endDate, mode);
                res.json(result);
            });
    } else {
        return res.status(400).send("Oopsies.");
    }
}

ff.http("nightlydigest-stats", nightlyDigestStatsHandler);