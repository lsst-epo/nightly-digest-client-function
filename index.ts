import 'dotenv/config'
import * as ff from '@google-cloud/functions-framework';
import axios from "axios";
import { NightlyDigestBaseResponse } from './types';

export const getConfig = () => {
    return {
        endpoints: {
            API_ENDPOINT: process.env.ND_API_ENDPOINT,
            CACHE_ENDPOINT: process.env.ND_CACHE_ENDPOINT
        }
    };
};

const { API_ENDPOINT, CACHE_ENDPOINT } = getConfig().endpoints;

export async function cacheResult(endpoint: string, cache_endpoint: string, params: any, data: any) {
    try {
        const payload = { endpoint: endpoint, params: params, data: data }
        await axios.post(
            cache_endpoint, payload
        )
    } catch (error: any) {
        console.warn(`Cache upload error: ${error.message}`)
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
    const bearerToken = process.env.BEARER_TOKEN
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
        throw error;
    }
}


export async function processStats(req: ff.Request, res: ff.Response, cloudEndpoint: string, cacheEndpoint: string) {
    const mode = req.query?.mode || 'current'; // probably don't need this right now, but could be useful in the future if we want to expand beyond just getting current
    const startDate = req.query?.startDate as string
    const endDate = req.query?.endDate as string 
    let data = await fetchNightlyDigestData<NightlyDigestBaseResponse>(cloudEndpoint, startDate, endDate);

    let result = data;
    const currentData = extractCurrent(data);
    const lastExposure = currentData.last_exposure;

    let cleaned_result = {
        dome_open: currentData.last_can_see_sky ?? null,
        exposure_count: currentData.exposures_count ?? null
    }

    await cacheResult(cloudEndpoint, cacheEndpoint, mode, cleaned_result); 
    res.json(cleaned_result)
}

export async function nightlyDigestStatsHandler (req: ff.Request, res: ff.Response) {
    if (req.path == "/") {
        return res.status(200).send("🐈‍⬛"); 
    } else if (req.path == "/nightlydigest-stats") {
        return processStats(req, res, API_ENDPOINT as string, CACHE_ENDPOINT as string);
    } else {
        return res.status(400).send("Oopsies.");
    }
}

ff.http("nightlydigest-stats", nightlyDigestStatsHandler);