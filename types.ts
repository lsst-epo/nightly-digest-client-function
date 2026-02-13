export interface NightlyDigestExposure {
    exposure_id: number | null;
    exposure_name: string | null;
    exp_time: number | null;
    img_type: string | null;
    observation_reason: string | null;
    science_program: string | null;
    target_name: string | null;
    can_see_sky: string | null;
    band: string | null;
    obs_start: string | null;
    physical_filter: string | null;
    day_obs: number | null;
    seq_num: number | null;
    obs_end: string | null;
    overhead: number | null;
    zer_point_median: number | null;
    visit_id: number | null;
    pixel_scale_median: number | null;
    psf_sigma_median: number | null;
    visit_gap: number | null;
    [key: string]: unknown[] | unknown;
}

export interface NightlyDigestBaseResponse {
    exposures: NightlyDigestExposure[];
    exposures_count: number | null;
    [key: string]: unknown[] | unknown;
}

export interface NightlyDigestParams {
    mode?: string;
    startDate: string;
    endDate: string;
}

export interface CleanedNightlyStats {
    dome_open: boolean | null;
    exposure_count: number | null;
}

export interface CachePayload {
    endpoint: string;
    params: string | NightlyDigestParams;
    data: CleanedNightlyStats | NightlyDigestBaseResponse;
}

export interface Config {
    endpoints: {
        API_ENDPOINT: string;
        CACHE_ENDPOINT: string;
    };
    tokens: {
        REDIS_CACHE_TOKEN: string;
        AUTH_TOKEN: string;
    };
    params: {
        DAY_OBS_START: string;
        DAY_OBS_END: string;
        MODE: string;
        SURVEY_START_DATE: string;
    }
}