import { 
    getFormattedDate, 
    utcOffset, 
    formatDate, 
    parseYYYYMMDD, 
    isNextDay,
    getConfig
} from './utils';


describe('date utils', () => {
    const MOCK_DATE = new Date(Date.UTC(2026, 1, 9)); 

    beforeAll(() => {
        jest.useFakeTimers();
        jest.setSystemTime(MOCK_DATE);
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    describe('formatDate', () => {
        it('should format a Date object into YYYYMMDD', () => {
            const date = new Date(Date.UTC(2026, 0, 1));
            expect(formatDate(date)).toBe('20260101');
        });
    });

    describe('utcOffset', () => {
        it('should add days correctly', () => {
            const start = new Date(Date.UTC(2026, 0, 1));
            const result = utcOffset(start, 5);
            expect(formatDate(result)).toBe('20260106');
        });

        it('should subtract days correctly', () => {
            const start = new Date(Date.UTC(2026, 0, 1));
            const result = utcOffset(start, -1);
            expect(formatDate(result)).toBe('20251231');
        });

        it('should not update the original date', () => {
            const start = new Date(Date.UTC(2026, 0, 1));
            const originalTime = start.getTime();
            utcOffset(start, 5);
            expect(start.getTime()).toBe(originalTime);
        });
    });

    describe('parseYYYYMMDD', () => {
        it('should create a UTC date from a YYYYMMDD string', () => {
            const date = parseYYYYMMDD('20260209');
            expect(date.getUTCFullYear()).toBe(2026);
            expect(date.getUTCMonth()).toBe(1); 
            expect(date.getUTCDate()).toBe(9);
            expect(date.getUTCHours()).toBe(0);
        });
    });

    describe('getFormattedDate', () => {
        it('should return today string when no offset is provided', () => {
            expect(getFormattedDate()).toBe('20260209');
        });

        it('should return yesterday when offset is -1', () => {
            expect(getFormattedDate(-1)).toBe('20260208');
        });

        it('should handle leap years correctly', () => {
            jest.setSystemTime(new Date(Date.UTC(2028, 1, 28)));
            expect(getFormattedDate(1)).toBe('20280229');
        });
    });

    describe('isNextDay', () => {
        it('should return true if dates are consecutive', () => {
            expect(isNextDay('20260131', '20260201')).toBe(true);
        });

        it('should return false if dates are the same', () => {
            expect(isNextDay('20260131', '20260131')).toBe(false);
        });

        it('should return false if dates are more than 1 day apart', () => {
            expect(isNextDay('20260101', '20260103')).toBe(false);
        });

        it('should handle year rollover', () => {
            expect(isNextDay('20251231', '20260101')).toBe(true);
        });
    });
});

describe('getConfig call', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should return the config object from environment variables', () => {
        process.env.NIGHTLY_DIGEST_API_ENDPOINT = 'http://api.com';
        process.env.AUTH_TOKEN = 'blah';

        const config = getConfig();

        expect(config.endpoints.API_ENDPOINT).toBe('http://api.com');
        expect(config.tokens.AUTH_TOKEN).toBe('blah');
    });
});