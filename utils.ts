export const getFormattedDate = (offset?: number): string => {
    return formatDate(utcOffset(new Date(), offset));
}

export const utcOffset = (date: Date, offset: number = 0): Date => {
    const newDate = new Date(date.getTime());
    newDate.setUTCDate(newDate.getUTCDate() + offset);
    return newDate;
}


export const formatDate = (date: Date): string => {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
};

export const parseYYYYMMDD = (dateStr: string): Date => {
    const year = parseInt(dateStr.slice(0, 4), 10);
    const month = parseInt(dateStr.slice(4, 6), 10) - 1;
    const day = parseInt(dateStr.slice(6, 8), 10);

    return new Date(Date.UTC(year, month, day));
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
            API_ENDPOINT: process.env.NIGHTLY_DIGEST_API_ENDPOINT as string,
            CACHE_ENDPOINT: process.env.NIGHTLY_DIGEST_CACHE_ENDPOINT as string
        },
        tokens: {
            REDIS_CACHE_TOKEN: process.env.REDIS_CACHE_TOKEN as string,
            AUTH_TOKEN: process.env.AUTH_TOKEN as string
        },
        params: {
            DAY_OBS_START: process.env.DAY_OBS_START as string,
            DAY_OBS_END: process.env.DAY_OBS_END as string,
            MODE: process.env.MODE as string,
            SURVEY_START_DATE: process.env.SURVEY_START_DATE as string
        }
        
    };
};