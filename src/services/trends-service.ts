import {
    getCategoryNewsTrends,
    getDailyTrends,
    getGlobalGoogleTrends,
    getSocialMediaViralNews,
    getXTwitterTrends,
    TrendItem,
} from '@/lib/trends';

class TrendsService {
    private cache: { [key: string]: { data: TrendItem[], timestamp: number } } = {};
    private CACHE_TTL = 1000 * 60 * 20; // 20 minutos

    /**
     * Tendencias en vivo a nivel MUNDIAL (Ecuador incluido como un mercado más):
     * - Modo abierto ('OPEN_TRENDS' o categorías "Tendencias …"): todas las fuentes globales intercaladas
     * - Con categoría: noticias de esa categoría (ES + EN) mezcladas con lo más viral del mundo
     */
    async getDailyTrends(category?: string): Promise<TrendItem[]> {
        const isOpenTrendMode = !category || category === 'OPEN_TRENDS' || category.toLowerCase().startsWith('tendencias');
        const cacheKey = isOpenTrendMode ? 'OPEN' : `CAT_${category}`;
        const cached = this.cache[cacheKey];
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            return cached.data;
        }

        try {
            let merged: TrendItem[] = [];

            if (isOpenTrendMode) {
                merged = await getDailyTrends();
            } else {
                const [categoryNews, socialViral, xWorld, googleGlobal] = await Promise.all([
                    getCategoryNewsTrends(category!, 6),
                    getSocialMediaViralNews(2),
                    getXTwitterTrends('', 4),
                    getGlobalGoogleTrends(3),
                ]);
                merged = [
                    ...categoryNews,
                    ...googleGlobal.slice(0, 5),
                    ...xWorld,
                    ...socialViral,
                ];
            }

            this.cache[cacheKey] = { data: merged, timestamp: Date.now() };
            return merged;
        } catch (error) {
            console.error('[TrendsService] Error obteniendo tendencias:', error);
            return [];
        }
    }

    /**
     * Texto con las tendencias para incluir en los prompts.
     */
    async getTrendsContext(limit: number = 20, category?: string): Promise<string> {
        const trends = await this.getDailyTrends(category);
        if (trends.length === 0) return '';

        const topTrends = trends
            .slice(0, limit)
            .map(t => `- [${t.traffic}] "${t.title}"${t.newsItemTitle && t.newsItemTitle !== t.title ? ` — ${t.newsItemTitle}` : ''}`)
            .join('\n');

        return `TENDENCIAS EN TIEMPO REAL A NIVEL MUNDIAL (Google Trends de varios países, X/Twitter mundial, noticias internacionales, virales en redes, Reddit; Ecuador incluido como un mercado más):\n${topTrends}`;
    }
}

export const trendsService = new TrendsService();
