import Parser from 'rss-parser';

export interface TrendItem {
    title: string;
    link: string;
    pubDate: string;
    traffic: string;
    source?: 'google_trends' | 'google_news' | 'hacker_news' | 'x_twitter' | 'reddit_viral' | 'social_viral';
    categoryHint?: string;
    pictureUrl?: string;
    newsItemTitle?: string;
    newsItemUrl?: string;
}

const parser = new Parser({
    customFields: {
        item: [
            ['ht:approx_traffic', 'traffic'],
            ['ht:picture', 'picture'],
            ['ht:news_item', 'news_item'],
        ],
    },
});

const CATEGORY_SEARCH_MAP: Record<string, string> = {
    ia: 'Inteligencia Artificial OR OpenAI OR Gemini OR Claude OR Robotica',
    software: 'Desarrollo de Software OR Programacion OR Apps OR GitHub',
    hardware: 'Hardware OR Nvidia OR Procesadores OR Smartphones OR Gadgets',
    ciberseguridad: 'Ciberseguridad OR Hackers OR Vulnerabilidad OR Datos',
    technology: 'Tecnologia OR Inteligencia Artificial OR Gadgets',
    salud: 'Salud OR Longevidad OR Ciencia Medica',
    nutricion: 'Nutricion OR Dieta OR Alimentos Saludables',
    business: 'Negocios OR Startups OR Finanzas OR Economia',
    motivation: 'Productividad OR Psicologia OR Habitos',
};

/**
 * Helper: Format today's dynamic trend category name (e.g. "Tendencias 16 Oct")
 */
export function getTodayTrendCategoryName(): string {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    return `Tendencias ${now.getDate()} ${months[now.getMonth()]}`;
}

/**
 * 1. Fetch Live Google Trends RSS (Default: EC for Ecuador)
 */
export async function getGoogleTrendsRSS(geo = 'EC'): Promise<TrendItem[]> {
    try {
        const response = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
            },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return (feed.items || []).map((item: any) => {
            const newsTitle =
                item.news_item?.['ht:news_item_title']?.[0] ||
                item.news_item?.news_item_title ||
                item.contentSnippet ||
                item.title;
            const newsUrl =
                item.news_item?.['ht:news_item_url']?.[0] ||
                item.news_item?.news_item_url ||
                item.link;

            return {
                title: item.title || 'Trending Topic',
                link: newsUrl || item.link || 'https://trends.google.com',
                pubDate: item.pubDate || new Date().toISOString(),
                traffic: `Google Trends ${geo} (${item.traffic || 'Viral'})`,
                source: 'google_trends' as const,
                pictureUrl: item.picture,
                newsItemTitle: newsTitle,
                newsItemUrl: newsUrl,
            };
        });
    } catch (error) {
        console.error('[Trends] Error fetching Google Trends RSS:', error);
        return [];
    }
}

/**
 * 2. Fetch X (Twitter) Live Trending Topics (Default: Ecuador via public Trends24 aggregator)
 */
export async function getXTwitterTrends(countrySlug: 'ecuador' | 'united-states' | 'spain' | 'mexico' = 'ecuador', limit = 8): Promise<TrendItem[]> {
    try {
        const response = await fetch(`https://trends24.in/${countrySlug}/`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
            },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const html = await response.text();
        const matches = [...html.matchAll(/class=[^>]*trend-link[^>]*>([^<]+)<\/a>/gi)]
            .map(m => m[1]?.trim())
            .filter(Boolean);

        // Deduplicate while preserving top order
        const unique = [...new Set(matches)].slice(0, limit);

        return unique.map(topic => ({
            title: topic,
            link: `https://x.com/search?q=${encodeURIComponent(topic)}`,
            pubDate: new Date().toISOString(),
            traffic: `X / Twitter Top (${countrySlug.toUpperCase()})`,
            source: 'x_twitter' as const,
            newsItemTitle: `Tendencia activa en X (Twitter ${countrySlug}): ${topic}`,
            newsItemUrl: `https://x.com/search?q=${encodeURIComponent(topic)}`,
        }));
    } catch (error) {
        console.error('[Trends] Error fetching X/Twitter trends:', error);
        return [];
    }
}

/**
 * 2B. Fetch Live Ecuador Breaking News & Viral Stories (24h)
 */
export async function getEcuadorBreakingNews(limit = 6): Promise<TrendItem[]> {
    try {
        const query = '(Ecuador OR Quito OR Guayaquil OR Cuenca OR LigaPro OR "La Tri") when:1d';
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=EC&ceid=EC:es-419`;

        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return (feed.items || []).slice(0, limit).map((item: any) => {
            const rawTitle = item.title || '';
            const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
            return {
                title: cleanTitle || rawTitle,
                link: item.link || 'https://news.google.com',
                pubDate: item.pubDate || new Date().toISOString(),
                traffic: 'Tendencia Ecuador (24h)',
                source: 'google_news' as const,
                newsItemTitle: rawTitle,
                newsItemUrl: item.link,
            };
        });
    } catch (error) {
        console.error('[Trends] Error fetching Ecuador breaking news:', error);
        return [];
    }
}

/**
 * 3. Fetch Viral Social Media Phenomena (TikTok, Instagram, Facebook, X viral stories in last 24h)
 */
export async function getSocialMediaViralNews(limit = 6): Promise<TrendItem[]> {
    try {
        const query = '(viral OR tendencia OR TikTok OR Instagram OR "redes sociales" OR polémico OR increíble) when:1d';
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=EC&ceid=EC:es-419`;

        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return (feed.items || []).slice(0, limit).map((item: any) => {
            const rawTitle = item.title || '';
            const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
            return {
                title: cleanTitle || rawTitle,
                link: item.link || 'https://news.google.com',
                pubDate: item.pubDate || new Date().toISOString(),
                traffic: 'Viral en Redes (24h)',
                source: 'social_viral' as const,
                newsItemTitle: rawTitle,
                newsItemUrl: item.link,
            };
        });
    } catch (error) {
        console.error('[Trends] Error fetching Social Media viral news:', error);
        return [];
    }
}

/**
 * 4. Fetch Global Breaking News (Unrestricted Top Stories across World, Entertainment, Science, Sports, Business)
 */
export async function getGlobalTopNews(limit = 8): Promise<TrendItem[]> {
    try {
        const url = `https://news.google.com/rss?hl=es-419&gl=EC&ceid=EC:es-419`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return (feed.items || []).slice(0, limit).map((item: any) => {
            const rawTitle = item.title || '';
            const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
            return {
                title: cleanTitle || rawTitle,
                link: item.link || 'https://news.google.com',
                pubDate: item.pubDate || new Date().toISOString(),
                traffic: 'Top Mundial / Latam (24h)',
                source: 'google_news' as const,
                newsItemTitle: rawTitle,
                newsItemUrl: item.link,
            };
        });
    } catch (error) {
        console.error('[Trends] Error fetching Global Top News:', error);
        return [];
    }
}

/**
 * 5. Fetch Reddit r/popular Viral Posts
 */
export async function getRedditViralTrends(limit = 5): Promise<TrendItem[]> {
    try {
        const response = await fetch('https://www.reddit.com/r/popular/.rss', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
            },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return (feed.items || []).slice(0, limit).map((item: any) => ({
            title: item.title || 'Reddit Viral Post',
            link: item.link || 'https://www.reddit.com/r/popular',
            pubDate: item.pubDate || new Date().toISOString(),
            traffic: 'Reddit r/popular',
            source: 'reddit_viral' as const,
            newsItemTitle: item.title,
            newsItemUrl: item.link,
        }));
    } catch (error) {
        console.error('[Trends] Error fetching Reddit RSS:', error);
        return [];
    }
}

/**
 * 6. Fetch Real-Time Google News RSS by Specific Category (when user specifically filters by a category)
 */
export async function getCategoryNewsTrends(categoryName: string, limit = 5): Promise<TrendItem[]> {
    try {
        const normalized = categoryName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const searchQuery = CATEGORY_SEARCH_MAP[normalized] || categoryName;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${searchQuery} when:2d`)}&hl=es-419&gl=EC&ceid=EC:es-419`;

        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            next: { revalidate: 1800 }
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return (feed.items || []).slice(0, limit).map((item: any) => {
            const rawTitle = item.title || '';
            const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();

            return {
                title: cleanTitle || rawTitle,
                link: item.link || 'https://news.google.com',
                pubDate: item.pubDate || new Date().toISOString(),
                traffic: 'Noticia 48h',
                source: 'google_news' as const,
                categoryHint: categoryName,
                newsItemTitle: rawTitle,
                newsItemUrl: item.link,
            };
        });
    } catch (error) {
        console.error(`[Trends] Error fetching Google News for ${categoryName}:`, error);
        return [];
    }
}

/**
 * 7. Fetch Viral Tech/Science Front-Page Stories from Hacker News (Algolia API)
 */
export async function getHackerNewsTrends(limit = 4): Promise<TrendItem[]> {
    try {
        const response = await fetch(`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}`, {
            next: { revalidate: 1800 }
        });
        if (!response.ok) return [];

        const data = await response.json();
        return (data.hits || []).map((hit: any) => ({
            title: hit.title,
            link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            pubDate: hit.created_at || new Date().toISOString(),
            traffic: `HN (${hit.points || 100}+ pts)`,
            source: 'hacker_news' as const,
            newsItemTitle: `${hit.title} (${hit.num_comments || 0} comments)`,
            newsItemUrl: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        }));
    } catch (error) {
        console.error('[Trends] Error fetching Hacker News:', error);
        return [];
    }
}

/**
 * Unified Open Multi-Network Trends Fetcher (Focused on ECUADOR + Global Viral)
 * Combines:
 *  - Google Trends Live (EC - Ecuador + US Global)
 *  - X (Twitter) Trending Topics in Ecuador (trends24.in/ecuador)
 *  - Ecuador Breaking News 24h (Quito, Guayaquil, Cuenca, LigaPro, La Tri, Nacional)
 *  - TikTok / Instagram / Social Viral News (24h)
 *  - Global Top News (World, Sports, Entertainment, Science, Economy)
 *  - Reddit r/popular Viral + Hacker News
 */
export async function getDailyTrends(geo = 'EC', categories: string[] = []): Promise<TrendItem[]> {
    const [
        googleTrendsEC,
        xTrendsEC,
        ecuadorNews,
        socialViral,
        globalTopNews,
        googleTrendsUS,
        redditViral,
        hnTrends,
    ] = await Promise.all([
        getGoogleTrendsRSS(geo || 'EC'),
        getXTwitterTrends('ecuador', 8),
        getEcuadorBreakingNews(6),
        getSocialMediaViralNews(5),
        getGlobalTopNews(5),
        getGoogleTrendsRSS('US'),
        getRedditViralTrends(3),
        getHackerNewsTrends(3),
    ]);

    const combined: TrendItem[] = [
        ...xTrendsEC,
        ...googleTrendsEC.slice(0, 8),
        ...ecuadorNews,
        ...socialViral,
        ...globalTopNews,
        ...googleTrendsUS.slice(0, 4),
        ...redditViral,
        ...hnTrends,
    ];

    // Deduplicate by normalized title prefix
    const seen = new Set<string>();
    return combined.filter(item => {
        const key = item.title.toLowerCase().trim().slice(0, 40);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
