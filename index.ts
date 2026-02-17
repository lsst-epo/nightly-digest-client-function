import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import axios from "axios";
import { NightlyDigestBaseResponse, NightlyDigestParams, CleanedNightlyStats, Config } from './types';
import { NextFunction } from 'express';
import { getConfig, utcOffset, formatDate, parseYYYYMMDD, isNextDay} from './utils';

export async function cacheResult(config: Config, params: string | NightlyDigestParams, data: CleanedNightlyStats | NightlyDigestBaseResponse, startDate?: string) {
    const endpoint = config.endpoints.API_ENDPOINT;
    const cacheEndpoint = config.endpoints.CACHE_ENDPOINT;
    const redisCacheToken = config.tokens.REDIS_CACHE_TOKEN;
    
    try {
        const payload = { endpoint: endpoint, params: params, data: data, startDate: startDate }
        const response = await axios.post(
            cacheEndpoint, 
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${redisCacheToken}`
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

export async function processStats(config: Config, startDate: string, endDate: string, mode: string) {
    const { API_ENDPOINT } = config.endpoints;
    
    const data = await fetchNightlyDigestData<NightlyDigestBaseResponse>(API_ENDPOINT, startDate, endDate);
    const currentData = extractCurrent(data);

    const cleanedResult = {
        dome_open: currentData.last_can_see_sky ?? null,
        exposure_count: currentData.exposures_count // guaranteed to default to 0, not null via extractCurrent()
    } as CleanedNightlyStats;

    const bucketDate = isNextDay(startDate, endDate) ? startDate : undefined;

    await cacheResult(config, mode, cleanedResult, bucketDate); 
    return cleanedResult;

}

export async function reaccumulateExposures(config: Config, surveyStartDateStr: string, endDateStr: string, dateInterval: number = 1) {
    let currentDate = parseYYYYMMDD(surveyStartDateStr);
    const endDate = parseYYYYMMDD(endDateStr);

    let cleanedResult = {
        dome_open: null,
        exposure_count: 0
    } as CleanedNightlyStats;

    let lastResult: CleanedNightlyStats | null = null;
    
    console.log(`reaccumlating from ${currentDate} to ${endDate}`);

    while(currentDate < endDate) {
        const dayStartStr = formatDate(currentDate);
        const dayEndStr = formatDate(utcOffset(currentDate, dateInterval));

        try {
            lastResult = await processStats(
                config,
                dayStartStr, 
                dayEndStr, 
                'reaccumulate'
            );

            cleanedResult['dome_open'] = cleanedResult['dome_open']; 
            cleanedResult['exposure_count'] = Number(cleanedResult['exposure_count']) + Number(lastResult['exposure_count']); // each component should be guaranteed to default to 0
            
        } catch (error) {
            console.error(`Error on ${dayStartStr}: `, error);
        }
        currentDate = utcOffset(currentDate, dateInterval);
    }
    return cleanedResult;
}

export function bearerAuth(req: ff.Request, res: ff.Response, next: NextFunction, authToken: string) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({error: "Unauthorized: Missing Bearer Token"});
    }

    const token = authHeader.split(' ')[1];

    if (token !== authToken as string) {
        return res.status(401).json({error: "Unauthorized: Invalid Token"});
    }

    return next();
}

export async function nightlyDigestStatsHandler (req: ff.Request, res: ff.Response) {
    const config = getConfig();

    return bearerAuth(
        req,
        res, 
        async () => {
            if (req.path == "/") {
                return res.status(200).send("🐈‍⬛"); 
            }
            if (req.path == "/nightly-digest-stats") {
                const config = getConfig();
                const mode = (config.params.MODE || req.query.mode || 'current') as string; // probably don't need this right now, but could be useful in the future if we want to expand beyond just getting current
                const startDate = (config.params.DAY_OBS_START || req.query.startDate || formatDate(utcOffset(new Date(), -1)) ) as string;
                const endDate = (config.params.DAY_OBS_END || req.query.endDate || formatDate(utcOffset(new Date(), 0)) ) as string;
                const overrideRunDate = (req.query.overrideRunDate || false ) as boolean;
                const surveyStartDate = config.params.SURVEY_START_DATE as string;

                let result = undefined;

                if (!overrideRunDate) {
                    result = await processStats(config, startDate, endDate, mode);
                } else {
                    result = await reaccumulateExposures(config, surveyStartDate, endDate, 30);
                }
                return res.json(result);
            }
            return res.status(400).json({ status: "error", reason: "bad request" })
    }, config.tokens.AUTH_TOKEN);
}

ff.http("nightlydigest-stats", nightlyDigestStatsHandler);