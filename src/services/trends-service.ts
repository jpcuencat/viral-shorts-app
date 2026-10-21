import {
    getCategoryNewsTrends,
    getDailyTrends,
    getGoogleTrendsRSS,
    getSocialMediaViralNews,
    getXTwitterTrends,
    TrendItem,
} from '@/lib/trends';

class TrendsService {
    private cache: { [key: string]: { data: TrendItem[], timestamp: number } } = {};
    private CACHE_TTL = 1000 * 60 * 20; // 20 minutes cache

    /**
     * Fetch live trends:
     * - If category is 'OPEN_TRENDS' or starts with 'Tendencias', fetches unrestricted global + social trends (X, TikTok/IG, Reddit, Google Trends, Top News)
     * - Otherwise blends specific category news with top social/global trends
     */
    async getDailyTrends(geo: string = 'EC', category?: string): Promise<TrendItem[]> {
        const isOpenTrendMode = !category || category === 'OPEN_TRENDS' || category.toLowerCase().startsWith('tendencias');
        const cacheKey = `${geo}_${isOpenTrendMode ? 'OPEN' : category}`;
        const cached = this.cache[cacheKey];
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            return cached.data;
        }

        try {
            let merged: TrendItem[] = [];

            if (isOpenTrendMode) {
                merged = await getDailyTrends(geo);
            } else {
                const [categoryNews, socialViral, xTrends, googleTrends] = await Promise.all([
                    getCategoryNewsTrends(category!, 6),
                    getSocialMediaViralNews(3),
                    getXTwitterTrends('ecuador', 4),
                    getGoogleTrendsRSS(geo),
                ]);
                merged = [
                    ...categoryNews,
                    ...xTrends,
                    ...googleTrends.slice(0, 4),
                    ...socialViral,
                ];
            }

            this.cache[cacheKey] = {
                data: merged,
                timestamp: Date.now(),
            };

            return merged;
        } catch (error) {
            console.error('[TrendsService] Failed to fetch live trends:', error);
            return [];
        }
    }

    /**
     * Get a formatted string of top live trends & social phenomena for prompt injection
     */
    async getTrendsContext(geo: string = 'EC', limit: number = 14, category?: string): Promise<string> {
        const trends = await this.getDailyTrends(geo, category);

        if (trends.length === 0) {
            return '';
        }

        const sourceLabels: Record<string, string> = {
            x_twitter: 'X / Twitter Ecuador',
            social_viral: 'Viral TikTok/IG/Redes',
            google_trends: 'Google Trends Ecuador',
            google_news: 'Noticia Impacto 24h (Ecuador/Mundo)',
            reddit_viral: 'Reddit Viral',
            hacker_news: 'Tech Viral',
        };

        const topTrends = trends
            .slice(0, limit)
            .map(t => `- [${sourceLabels[t.source || 'google_trends'] || 'Tendencia'}] "${t.title}" (${t.traffic})`)
            .join('\n');

        return `TENDENCIAS EN TIEMPO REAL EN ECUADOR Y EL MUNDO (X/Twitter Ecuador, Google Trends EC, Noticias Ecuador 24h, TikTok/IG y Global):\n${topTrends}`;
    }
}

export const trendsService = new TrendsService();
