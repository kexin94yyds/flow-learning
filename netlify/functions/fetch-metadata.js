// Netlify Function: Fetch page metadata (title, image)
// Mirrors the logic used in the desktop Electron app.

const fetch = require('node-fetch');
const cheerio = require('cheerio');

exports.handler = async (event) => {
  const url = (event.queryStringParameters && event.queryStringParameters.url) || '';

  if (!url || !/^https?:\/\//i.test(url)) {
    return jsonResponse({ title: '', image: '' });
  }

  try {
    const metadata = await fetchMetadata(url);
    return jsonResponse(metadata);
  } catch (err) {
    console.error('Netlify fetch-metadata error:', err);
    return jsonResponse({ title: '', image: '' });
  }
};

async function fetchMetadata(url) {
  // Special handling for Twitter/X to improve success rate:
  // 尽量拿到推文里的图片，而不是只看到通用的 "X / ?" 标题。
  if (isTwitterUrl(url)) {
    const twitterData = await fetchTwitterMetadata(url).catch(() => null);
    if (twitterData && (twitterData.title || twitterData.image)) {
      return twitterData;
    }
  }

  // Default desktop-like behaviour: 抓 og:title / og:image
  return await fetchWithUserAgent(
    url,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
  );
}

function isTwitterUrl(url) {
  return /twitter\.com|x\.com/i.test(url);
}

function parseTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchTwitterMetadata(url) {
  const tweetId = parseTweetId(url);
  if (!tweetId) return null;

  // 使用 Twitter 公开的 syndication 接口拿到更完整的信息
  const apiUrl = `https://cdn.syndication.twimg.com/tweet?id=${tweetId}`;
  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*'
    },
    timeout: 8000
  });

  if (!res.ok) return null;

  const data = await res.json();

  const title =
    (data.text || data.full_text || '')
      .replace(/\s+/g, ' ')
      .trim();

  let image = '';
  if (Array.isArray(data.photos) && data.photos.length > 0) {
    image =
      data.photos[0].url ||
      data.photos[0].image_url ||
      data.photos[0].media_url_https ||
      '';
  }

  // 如果推文本身没图，就退回到头像
  if (!image && data.user) {
    image =
      data.user.profile_image_url_https ||
      data.user.profile_image_url ||
      '';
  }

  if (!title && !image) return null;
  return { title, image };
}

async function fetchWithUserAgent(url, userAgent) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent
    },
    timeout: 8000
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

function jsonResponse(payload) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Allow calling from any origin hosting this static bundle.
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(payload)
  };
}
