// Netlify Function: Fetch page metadata (title, image)
// 实现逻辑对齐桌面端 main.js 里的 ipcMain.handle('fetch-metadata')

const fetch = require('node-fetch');
const cheerio = require('cheerio');

exports.handler = async (event) => {
  const url = (event.queryStringParameters && event.queryStringParameters.url) || '';

  if (!url || !/^https?:\/\//i.test(url)) {
    return jsonResponse({ title: '', image: '' });
  }

  try {
    const data = await fetchMetadata(url);
    return jsonResponse(data);
  } catch (err) {
    console.error('Netlify fetch-metadata error:', err);
    return jsonResponse({ title: '', image: '' });
  }
};

async function fetchMetadata(url) {
  if (!url.startsWith('http')) {
    return { title: '', image: '' };
  }

  // 优先针对 YouTube 做更稳的处理（桌面端通常也能从 og 标签拿到同样信息）
  if (isYoutubeUrl(url)) {
    try {
      const yt = await fetchYoutubeMetadata(url);
      if (yt && (yt.title || yt.image)) {
        return yt;
      }
    } catch (e) {
      console.error('YouTube oEmbed metadata error:', e);
      // 失败则退回到通用逻辑
    }
  }

  // 与桌面端一样：Twitter/X 使用专门的 UA 以获得 OpenGraph 标签
  if (url.includes('twitter.com') || url.includes('x.com')) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
      },
      timeout: 5000
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      '';

    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    return { title: title.trim(), image };
  }

  // 其他网站：和桌面端一样，用桌面浏览器 UA 抓取 og:title / og:image
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
    },
    timeout: 5000
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').text() ||
    '';

  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';

  return { title: title.trim(), image };
}

function isYoutubeUrl(url) {
  return /youtube\.com\/watch|youtu\.be\//i.test(url);
}

async function fetchYoutubeMetadata(url) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    url
  )}&format=json`;

  const res = await fetch(oembedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json,text/plain,*/*'
    },
    timeout: 5000
  });

  if (!res.ok) {
    throw new Error(`YouTube oEmbed HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    title: (data.title || '').trim(),
    image: data.thumbnail_url || ''
  };
}

function jsonResponse(payload) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(payload)
  };
}
