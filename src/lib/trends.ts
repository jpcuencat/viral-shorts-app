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
    /** Países (códigos ISO) donde el tema es tendencia en Google Trends. */
    markets?: string[];
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
 * Mercados de Google Trends que se consultan. Las tendencias son MUNDIALES: Ecuador es un mercado más.
 * Se puede cambiar con la variable de entorno TRENDS_MARKETS (códigos ISO separados por coma).
 */
export const TREND_MARKETS: string[] = (process.env.TRENDS_MARKETS || 'US,GB,IN,BR,MX,ES,AR,CO,EC,PE,CL,DE,FR,JP')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function normalizeKey(text: string): string {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchNewsRss(url: string, limit: number, traffic: string, source: TrendItem['source'], categoryHint?: string): Promise<TrendItem[]> {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': UA }, next: { revalidate: 1800 } });
        if (!response.ok) return [];
        const feed = await parser.parseString(await response.text());
        return (feed.items || []).slice(0, limit).map((item: any) => {
            const rawTitle = item.title || '';
            const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
            return {
                title: cleanTitle || rawTitle,
                link: item.link || 'https://news.google.com',
                pubDate: item.pubDate || new Date().toISOString(),
                traffic,
                source,
                ...(categoryHint ? { categoryHint } : {}),
                newsItemTitle: rawTitle,
                newsItemUrl: item.link,
            };
        });
    } catch (error) {
        console.error(`[Trends] Error leyendo RSS (${traffic}):`, error);
        return [];
    }
}

/**
 * 1. Google Trends en vivo de un país (RSS oficial).
 */
export async function getGoogleTrendsRSS(geo = 'US'): Promise<TrendItem[]> {
    try {
        const response = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
            headers: {
                'User-Agent': UA,
                'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
            },
            next: { revalidate: 1800 }
        });
        if (!response.ok) return [];

        const feed = await parser.parseString(await response.text());
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
                markets: [geo],
            };
        });
    } catch (error) {
        console.error(`[Trends] Error leyendo Google Trends ${geo}:`, error);
        return [];
    }
}

/**
 * 1B. Google Trends de todos los mercados configurados, agrupado.
 * Un tema que es tendencia en varios países a la vez sube al principio (señal de viralidad mundial).
 */
export async function getGlobalGoogleTrends(perMarket = 6): Promise<TrendItem[]> {
    const results = await Promise.all(TREND_MARKETS.map(geo => getGoogleTrendsRSS(geo)));

    const groups = new Map<string, { item: TrendItem; markets: string[]; bestRank: number }>();
    results.forEach((items, mIdx) => {
        const geo = TREND_MARKETS[mIdx];
        items.slice(0, 15).forEach((item, rank) => {
            const key = normalizeKey(item.title);
            if (!key) return;
            const g = groups.get(key);
            if (g) {
                if (!g.markets.includes(geo)) g.markets.push(geo);
                g.bestRank = Math.min(g.bestRank, rank);
            } else {
                groups.set(key, { item, markets: [geo], bestRank: rank });
            }
        });
    });

    const all = [...groups.values()];
    // Multi-país primero (más países = más global); luego los mejores de cada mercado de forma equilibrada
    const multi = all.filter(g => g.markets.length >= 2).sort((a, b) => b.markets.length - a.markets.length || a.bestRank - b.bestRank);
    const single = all.filter(g => g.markets.length === 1 && g.bestRank < perMarket).sort((a, b) => a.bestRank - b.bestRank);

    return [...multi, ...single].map(g => ({
        ...g.item,
        markets: g.markets,
        traffic: g.markets.length >= 2
            ? `Google Trends en ${g.markets.length} países (${g.markets.join(', ')})`
            : `Google Trends ${g.markets[0]} (#${g.bestRank + 1})`,
    }));
}

/**
 * 2. Tendencias de X (Twitter) vía trends24.in. countrySlug vacío = MUNDIAL.
 */
export async function getXTwitterTrends(countrySlug = '', limit = 8): Promise<TrendItem[]> {
    const label = countrySlug ? countrySlug.toUpperCase() : 'MUNDIAL';
    try {
        const response = await fetch(`https://trends24.in/${countrySlug ? `${countrySlug}/` : ''}`, {
            headers: { 'User-Agent': UA },
            next: { revalidate: 1800 }
        });
        if (!response.ok) return [];

        const html = await response.text();
        const matches = [...html.matchAll(/class=[^>]*trend-link[^>]*>([^<]+)<\/a>/gi)]
            .map(m => m[1]?.trim())
            .filter(Boolean);
        const unique = [...new Set(matches)].slice(0, limit);

        return unique.map(topic => ({
            title: topic,
            link: `https://x.com/search?q=${encodeURIComponent(topic)}`,
            pubDate: new Date().toISOString(),
            traffic: `X / Twitter (${label})`,
            source: 'x_twitter' as const,
            newsItemTitle: `Tendencia activa en X (${label}): ${topic}`,
            newsItemUrl: `https://x.com/search?q=${encodeURIComponent(topic)}`,
        }));
    } catch (error) {
        console.error(`[Trends] Error leyendo X/Twitter (${label}):`, error);
        return [];
    }
}

/**
 * 3. Noticias mundiales del día (sección Mundo en español + titulares internacionales en inglés).
 */
export async function getWorldNews(limit = 6): Promise<TrendItem[]> {
    const [es, en] = await Promise.all([
        fetchNewsRss('https://news.google.com/rss/headlines/section/topic/WORLD?hl=es-419&gl=US&ceid=US:es-419', limit, 'Noticia Mundial (24h)', 'google_news'),
        fetchNewsRss('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', limit, 'Top News Internacional (24h)', 'google_news'),
    ]);
    return [...es, ...en];
}

/**
 * 3B. Noticias de Ecuador (24h). Ecuador es un mercado más dentro del panorama mundial.
 */
export async function getEcuadorBreakingNews(limit = 4): Promise<TrendItem[]> {
    const query = '(Ecuador OR Quito OR Guayaquil OR Cuenca OR LigaPro OR "La Tri") when:1d';
    return fetchNewsRss(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es-419&gl=EC&ceid=EC:es-419`,
        limit, 'Noticia Ecuador (24h)', 'google_news'
    );
}

/**
 * 4. Fenómenos virales en redes (TikTok, Instagram, X…) de las últimas 24h, en español e inglés.
 */
export async function getSocialMediaViralNews(limit = 5): Promise<TrendItem[]> {
    const qEs = '(viral OR tendencia OR TikTok OR Instagram OR "redes sociales") when:1d';
    const qEn = '(viral OR TikTok OR "goes viral" OR trending OR meme) when:1d';
    const [es, en] = await Promise.all([
        fetchNewsRss(`https://news.google.com/rss/search?q=${encodeURIComponent(qEs)}&hl=es-419&gl=US&ceid=US:es-419`, limit, 'Viral en Redes (24h, ES)', 'social_viral'),
        fetchNewsRss(`https://news.google.com/rss/search?q=${encodeURIComponent(qEn)}&hl=en-US&gl=US&ceid=US:en`, limit, 'Viral en Redes (24h, EN)', 'social_viral'),
    ]);
    return [...es, ...en];
}

/**
 * 5. Reddit r/popular.
 */
export async function getRedditViralTrends(limit = 5): Promise<TrendItem[]> {
    try {
        const response = await fetch('https://www.reddit.com/r/popular/.rss', {
            headers: { 'User-Agent': UA },
            next: { revalidate: 1800 }
        });
        if (!response.ok) return [];
        const feed = await parser.parseString(await response.text());
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
        console.error('[Trends] Error leyendo Reddit:', error);
        return [];
    }
}

/**
 * 6. Noticias de una categoría concreta (48h), en español e inglés, sin limitar a un país.
 */
export async function getCategoryNewsTrends(categoryName: string, limit = 5): Promise<TrendItem[]> {
    const normalized = categoryName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const searchQuery = CATEGORY_SEARCH_MAP[normalized] || categoryName;
    const half = Math.max(2, Math.ceil(limit / 2));
    const [es, en] = await Promise.all([
        fetchNewsRss(`https://news.google.com/rss/search?q=${encodeURIComponent(`${searchQuery} when:2d`)}&hl=es-419&gl=US&ceid=US:es-419`, half, 'Noticia 48h (ES)', 'google_news', categoryName),
        fetchNewsRss(`https://news.google.com/rss/search?q=${encodeURIComponent(`${categoryName} when:2d`)}&hl=en-US&gl=US&ceid=US:en`, half, 'Noticia 48h (EN)', 'google_news', categoryName),
    ]);
    return [...es, ...en];
}

/**
 * 7. Hacker News (portada).
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
        console.error('[Trends] Error leyendo Hacker News:', error);
        return [];
    }
}

/**
 * Tendencias MUNDIALES unificadas (Ecuador incluido como un mercado más):
 *  - Google Trends de TREND_MARKETS, priorizando temas que son tendencia en varios países
 *  - X (Twitter) mundial + Ecuador
 *  - Noticias mundiales (ES + EN) y de Ecuador
 *  - Virales en redes (ES + EN), Reddit r/popular y Hacker News
 * El orden intercala fuentes para que ningún país o red monopolice la lista.
 */
export async function getDailyTrends(_geo = '', _categories: string[] = []): Promise<TrendItem[]> {
    const [googleGlobal, xWorld, xEcuador, worldNews, ecuadorNews, socialViral, redditViral, hnTrends] = await Promise.all([
        getGlobalGoogleTrends(5),
        getXTwitterTrends('', 8),
        getXTwitterTrends('ecuador', 4),
        getWorldNews(5),
        getEcuadorBreakingNews(4),
        getSocialMediaViralNews(4),
        getRedditViralTrends(3),
        getHackerNewsTrends(3),
    ]);

    const multiCountry = googleGlobal.filter(t => (t.markets?.length || 0) >= 2);
    const singleCountry = googleGlobal.filter(t => (t.markets?.length || 0) < 2);

    // Intercalado round-robin entre fuentes (las multi-país van primero)
    const buckets: TrendItem[][] = [singleCountry, xWorld, worldNews, socialViral, ecuadorNews, xEcuador, redditViral, hnTrends]
        .map(b => [...b]);
    const interleaved: TrendItem[] = [];
    while (buckets.some(b => b.length > 0)) {
        for (const b of buckets) {
            const next = b.shift();
            if (next) interleaved.push(next);
        }
    }

    const combined = [...multiCountry, ...interleaved];
    const seen = new Set<string>();
    return combined.filter(item => {
        const key = normalizeKey(item.title).slice(0, 40);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
