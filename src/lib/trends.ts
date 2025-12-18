import Parser from 'rss-parser';

export interface TrendItem {
    title: string;
    link: string;
    pubDate: string;
    traffic: string;
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

// Fallback data in case Google blocks the request (common in dev environments)
const MOCK_TRENDS: TrendItem[] = [
    {
        title: "SpaceX Starship",
        link: "https://www.spacex.com",
        pubDate: new Date().toISOString(),
        traffic: "500K+",
        newsItemTitle: "Starship successfully reaches orbit in latest test flight",
        newsItemUrl: "https://www.spacex.com",
        pictureUrl: "https://images.unsplash.com/photo-1517976487492-5750f3195933?w=800&q=80"
    },
    {
        title: "Artificial Intelligence Safety",
        link: "https://news.google.com",
        pubDate: new Date().toISOString(),
        traffic: "200K+",
        newsItemTitle: "New global summit on AI safety announced by tech leaders",
        pictureUrl: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=80"
    },
    {
        title: "World Cup 2026 Locations",
        link: "https://fifa.com",
        pubDate: new Date().toISOString(),
        traffic: "100K+",
        newsItemTitle: "FIFA announces new host cities for 2026 tournament",
        pictureUrl: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80"
    }
];

export async function getDailyTrends(geo = 'US'): Promise<TrendItem[]> {
    try {
        console.log('Fetching Google Trends RSS...');
        const response = await fetch(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://trends.google.com/',
                'Cache-Control': 'no-cache',
            },
            next: { revalidate: 3600 } // Cache for 1 hour to avoid being banned
        });

        if (!response.ok) {
            console.warn(`Google Trends URL failed (${response.status}). Switching to fallback.`);
            return MOCK_TRENDS;
        }

        const xml = await response.text();
        const feed = await parser.parseString(xml);

        return feed.items.map((item: any) => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
            traffic: item.traffic,
            pictureUrl: item.picture,
            newsItemTitle: item.news_item?.news_item_title,
            newsItemUrl: item.news_item?.news_item_url,
        }));
    } catch (error) {
        console.error('Error fetching trends (using mock data):', error);
        return MOCK_TRENDS;
    }
}
