
type TrendItem = {
    title: string;
    traffic: string;
    description: string;
    pubDate: string;
    link: string;
}

const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

class TrendsService {
    // 24 Hour Cache to save credits (Limit 250/mo ~ 8/day)
    // We strictly cache because 250 is low.
    private cache: { [geo: string]: { data: TrendItem[], timestamp: number } } = {};
    private CACHE_TTL = 1000 * 60 * 60 * 24;

    /**
     * Fetch Daily Trending Searches via SerpApi
     * @param geo Country code (US, ES, GB, etc.)
     */
    async getDailyTrends(geo: string = 'ES'): Promise<TrendItem[]> {
        // Check Cache
        const cached = this.cache[geo];
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            console.log(`[TrendsService] Returning cached trends for ${geo}`);
            return cached.data;
        }

        try {
            console.log(`[TrendsService] Fetching SerpApi trends for ${geo}...`);

            // Map 2-letter ISO to SerpApi "geo" parameter if needed, 
            // but SerpApi usually takes 2-letter codes for 'google_trends' engine?
            // Actually 'google_trends' engine parameters: 
            // - engine=google_trends
            // - q (query) or date/geo?
            // Daily Trends: engine=google_trends_trending_daily, geo=ES

            const params = new URLSearchParams({
                engine: 'google_trends_trending_daily',
                geo: geo,
                api_key: SERPAPI_KEY
            });

            const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
            const data = await response.json();

            if (data.error) {
                console.error('[TrendsService] SerpApi Error:', data.error);
                return [];
            }

            // Parse SerpApi Response (Daily Trends)
            // Structure: daily_searches: [ { query: "Real Madrid", formatted_traffic: "100K+", ... } ]
            const rawTrends = data.daily_searches?.[0]?.searches || [];

            const trends: TrendItem[] = rawTrends.map((item: any) => ({
                title: item.query,
                traffic: item.formatted_traffic || 'N/A',
                description: item.articles?.[0]?.title || '', // Use first article title as desc
                pubDate: item.articles?.[0]?.time_ago || new Date().toISOString(),
                link: item.articles?.[0]?.link || ''
            }));

            // Update Cache
            this.cache[geo] = {
                data: trends,
                timestamp: Date.now()
            };

            return trends;

        } catch (error) {
            console.error(`[TrendsService] Failed to fetch trends:`, error);
            return [];
        }
    }

    /**
     * Get a formatted string of top trends for prompt injection
     */
    async getTrendsContext(geo: string = 'ES', limit: number = 5): Promise<string> {
        const trends = await this.getDailyTrends(geo);

        if (trends.length === 0) {
            return `Current Trending Topics (Fallback):
- AI Technology
- Viral Challenges
- Netflix Series
- Football/Soccer
- Tech News`;
        }

        const topTrends = trends.slice(0, limit).map(t => `- ${t.title} (${t.traffic})`).join('\n');
        return `Current Trending Topics in ${geo}:\n${topTrends}`;
    }
}

export const trendsService = new TrendsService();
