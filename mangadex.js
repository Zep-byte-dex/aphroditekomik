export default async function handler(req, res) {
    const { action, id, q, tab, page, type, lang } = req.query;

    // CORS biar bisa diakses dari mana aja
    res.setHeader('Access-Control-Allow-Origin', '*');

    // ========== PROXY GAMBAR ==========
    if (action === 'image-proxy') {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: 'No URL' });
        try {
            const response = await fetch(url, {
                headers: { 'Referer': 'https://mangadex.org' }
            });
            const buffer = await response.arrayBuffer();
            res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(Buffer.from(buffer));
        } catch {
            return res.status(404).json({ error: 'Image not found' });
        }
    }

    try {
        const baseUrl = 'https://api.mangadex.org';
        let mangadexRes;

        // ========== DETAIL KOMIK ==========
        if (action === 'detail' && id) {
            mangadexRes = await fetch(`${baseUrl}/manga/${id}?includes[]=cover_art`);
            const data = await mangadexRes.json();
            const manga = data.data;
            
            const title = manga.attributes.title.en || 
                         Object.values(manga.attributes.title)[0] || 
                         'Unknown';
            
            const desc = manga.attributes.description?.en || 
                        'Belum ada sinopsis.';
            
            const coverId = manga.relationships.find(r => r.type === 'cover_art')?.id;
            let coverUrl = null;
            if (coverId) {
                const coverRes = await fetch(`${baseUrl}/cover/${coverId}`);
                const coverData = await coverRes.json();
                coverUrl = `https://uploads.mangadex.org/covers/${manga.id}/${coverData.data.attributes.fileName}`;
            }

            const genres = manga.attributes.tags
                ?.filter(t => t.attributes.group === 'genre')
                .map(t => t.attributes.name.en) || [];

            return res.json({
                success: true,
                data: {
                    id: manga.id,
                    title,
                    cover: coverUrl,
                    desc,
                    status: manga.attributes.status || 'unknown',
                    year: manga.attributes.year || '-',
                    author: manga.attributes.author || null,
                    tags: genres
                }
            });
        }

        // ========== DAFTAR CHAPTER ==========
        if (action === 'chapters' && id) {
            const params = new URLSearchParams({
                'manga': id,
                'translatedLanguage[]': lang || 'id',
                'order[chapter]': 'desc',
                'limit': 100,
                'includes[]': 'scanlation_group'
            });
            
            mangadexRes = await fetch(`${baseUrl}/chapter?${params}`);
            const data = await mangadexRes.json();
            
            const chapters = data.data.map(ch => ({
                id: ch.id,
                name: `Chapter ${ch.attributes.chapter || '?'}`,
                extra: ch.attributes.title ? ` - ${ch.attributes.title}` : '',
                lang: ch.attributes.translatedLanguage || 'id',
                date: new Date(ch.attributes.publishAt).toLocaleDateString('id-ID')
            }));

            return res.json({
                success: true,
                data: chapters,
                languages: ['id', 'en']
            });
        }

        // ========== HALAMAN CHAPTER ==========
        if (action === 'pages' && id) {
            mangadexRes = await fetch(`${baseUrl}/at-home/server/${id}`);
            const data = await mangadexRes.json();
            
            const base = data.baseUrl;
            const hash = data.chapter.hash;
            const pages = data.chapter.data.map(p => `${base}/data/${hash}/${p}`);

            return res.json({
                success: true,
                data: { image: pages }
            });
        }

        // ========== LIST / SEARCH KOMIK ==========
        const searchParams = new URLSearchParams();
        
        if (q) {
            // Mode SEARCH
            searchParams.set('title', q);
            searchParams.set('limit', 20);
        } else {
            // Mode LIST
            const order = tab === 'popular' ? 'rating' : 'latestUploadedChapter';
            searchParams.set('order[createdAt]', 'desc');
            searchParams.set('limit', 20);
            searchParams.set('offset', (page - 1) * 20);
            
            // Filter berdasarkan tipe (Manga/Manhwa/Manhua)
            if (type && type !== 'all') {
                searchParams.set('originalLanguage', 
                    type === 'manga' ? 'ja' : 
                    type === 'manhwa' ? 'ko' : 'zh'
                );
            }
            
            searchParams.set('contentRating[]', 'safe');
            searchParams.set('contentRating[]', 'suggestive');
            searchParams.set('contentRating[]', 'erotica');
            searchParams.set('includes[]', 'cover_art');
        }

        mangadexRes = await fetch(`${baseUrl}/manga?${searchParams}`);
        const data = await mangadexRes.json();

        const items = data.data.map(m => {
            const title = m.attributes.title.en || 
                         Object.values(m.attributes.title)[0] || 
                         'Unknown';
            
            const coverRel = m.relationships.find(r => r.type === 'cover_art');
            let cover = null;
            if (coverRel) {
                cover = `https://uploads.mangadex.org/covers/${m.id}/${coverRel.attributes.fileName}`;
            }
            
            const type = m.attributes.originalLanguage === 'ja' ? 'Manga' :
                        m.attributes.originalLanguage === 'ko' ? 'Manhwa' : 'Manhua';

            return {
                id: m.id,
                title,
                cover,
                type,
                status: m.attributes.status
            };
        });

        return res.json({
            success: true,
            items,
            hasMore: data.data.length === 20
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || 'Terjadi kesalahan'
        });
    }
}