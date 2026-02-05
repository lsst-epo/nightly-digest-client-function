export const getFormattedDate = (offset: number = 0): string => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    
    const iso = date.toISOString(); // "YYYY-MM-DDT18:20:40.052Z"
    
    return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10); // YYYYMMDD
};

export const isNextDay = (startDate: string, endDate: string): boolean => {
    const date = new Date(Date.UTC(
        Number(startDate.slice(0, 4)), 
        Number(startDate.slice(4, 6)) - 1, 
        Number(startDate.slice(6, 8))
    ));

    date.setUTCDate(date.getUTCDate() + 1); // day after

    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const dayAfterString = `${year}${month}${day}`;

    return dayAfterString === endDate;
}

export const getConfig = () => {
    return {
        endpoints: {
            API_ENDPOINT: process.env.NIGHTLY_DIGEST_API_ENDPOINT,
            CACHE_ENDPOINT: process.env.NIGHTLY_DIGEST_CACHE_ENDPOINT
        },
        tokens: {
            REDIS_CACHE_TOKEN: process.env.REDIS_CACHE_TOKEN,
            AUTH_TOKEN: process.env.AUTH_TOKEN
        },
        params: {
            DAY_OBS_START: process.env.DAY_OBS_START,
            DAY_OBS_END: process.env.DAY_OBS_END,
            MODE: process.env.MODE,
            TOTAL_EXPECTED_EXPOSURES: process.env.TOTAL_EXPECTED_EXPOSURES
        }
        
    };
};