const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const path = require('path');
const { TextDecoder } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache'
};

const MAX_REDIRECTS = 5;
const CMC_TIMEOUT_MS = 20_000;
const WHITEPAPER_TIMEOUT_MS = 60_000;
const MAX_WHITEPAPER_BYTES = 20 * 1024 * 1024;

const explorerDomains = new Set([
  'etherscan.io',
  'bscscan.com',
  'arbiscan.io',
  'polygonscan.com',
  'snowtrace.io',
  'solscan.io',
  'explorer.solana.com',
  'tronscan.org',
  'explorer.near.org',
  'optimistic.etherscan.io',
  'ftmscan.com',
  'cardanoscan.io',
  'celoscan.io',
  'moonriver.moonscan.io',
  'moonbeam.moonscan.io',
  'basescan.org',
  'scan.mantle.xyz',
  'scan.coredao.org',
  'blockscout.com',
  'gnosisscan.io'
]);

const socialDomains = {
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'discord.gg': 'discord',
  'discord.com': 'discord',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'reddit.com': 'reddit',
  'medium.com': 'medium',
  'mirror.xyz': 'mirror',
  'facebook.com': 'facebook',
  'instagram.com': 'instagram'
};

const repositoryDomains = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);
const linkAggregatorDomains = new Set(['linktr.ee', 'linktree.com']);

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const absolute = new URL(rawUrl, baseUrl);
    absolute.hash = '';
    return absolute.toString();
  } catch (error) {
    return null;
  }
}

function isSocialDomain(hostname) {
  return Object.prototype.hasOwnProperty.call(socialDomains, hostname);
}

function isExplorerDomain(hostname) {
  return explorerDomains.has(hostname) || hostname.endsWith('.etherscan.io');
}

function isRepositoryDomain(hostname) {
  return repositoryDomains.has(hostname);
}

function isLinkAggregatorDomain(hostname) {
  return linkAggregatorDomains.has(hostname);
}

function isDocsLink(urlObj, text) {
  const hostname = urlObj.hostname.toLowerCase();
  const href = urlObj.toString().toLowerCase();
  const lowerText = text.toLowerCase();

  if (hostname.startsWith('docs.')) {
    return true;
  }

  if (href.includes('/docs')) {
    return true;
  }

  return lowerText.includes('docs');
}

function isWhitepaperLink(urlObj, text) {
  const href = urlObj.toString().toLowerCase();
  const lowerText = text.toLowerCase();

  const keywords = ['whitepaper', 'white-paper', 'white paper', 'litepaper', 'lite-paper', 'lite paper'];

  return (
    keywords.some((keyword) => href.includes(keyword) || lowerText.includes(keyword)) ||
    href.endsWith('.pdf')
  );
}

function isWebsiteCandidate(urlObj, text) {
  const hostname = urlObj.hostname.toLowerCase();
  const href = urlObj.toString().toLowerCase();
  const lowerText = text.toLowerCase();

  if (isSocialDomain(hostname)) {
    return false;
  }

  if (isExplorerDomain(hostname)) {
    return false;
  }

  if (isRepositoryDomain(hostname)) {
    return false;
  }

  if (isLinkAggregatorDomain(hostname)) {
    return false;
  }

  if (hostname.startsWith('docs.') || href.includes('/docs')) {
    return false;
  }

  if (isWhitepaperLink(urlObj, lowerText)) {
    return false;
  }

  return true;
}

function extractLinksFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const anchors = new Set();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const text = $(element).text().trim();
    const normalized = normalizeUrl(href, pageUrl);

    if (!normalized) {
      return;
    }

    const urlObj = new URL(normalized);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return;
    }

    if (urlObj.hostname.toLowerCase().endsWith('coinmarketcap.com')) {
      return;
    }

    anchors.add(JSON.stringify({ url: urlObj.toString(), text }));
  });

  const result = {
    website: null,
    whitepaperUrl: null,
    coingecko: null,
    dextools: null
  };

  let docsCandidate = null;
  const seen = new Set();

  for (const item of anchors) {
    const { url, text } = JSON.parse(item);
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (!result.coingecko && hostname.includes('coingecko.com')) {
      result.coingecko = url;
    }

    if (!result.dextools && hostname.includes('dextools.io')) {
      result.dextools = url;
    }

    if (!result.whitepaperUrl && isWhitepaperLink(urlObj, text)) {
      result.whitepaperUrl = url;
      continue;
    }

    if (!result.website && isWebsiteCandidate(urlObj, text)) {
      result.website = url;
      continue;
    }

    if (!result.whitepaperUrl && !docsCandidate && isDocsLink(urlObj, text)) {
      docsCandidate = url;
    }
  }

  if (!result.whitepaperUrl && docsCandidate) {
    result.whitepaperUrl = docsCandidate;
  }

  return result;
}

async function fetchCoinMarketCapPage(url) {
  const response = await axios.get(url, {
    headers: BROWSER_HEADERS,
    timeout: CMC_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    validateStatus: () => true
  });

  if (response.status >= 400) {
    const error = new Error(`Fehler beim Abrufen der URL. Status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.data;
}

function parseCharset(contentTypeHeader = '') {
  const match = contentTypeHeader.toLowerCase().match(/charset=([^;]+)/);
  if (!match) {
    return 'utf-8';
  }

  return match[1].trim();
}

function normalizeWhitespace(text) {
  if (!text) {
    return null;
  }

  const normalizedLineEndings = text.replace(/\r\n?/g, '\n');
  const lines = normalizedLineEndings.split('\n').map((line) => line.trim().replace(/\s+/g, ' '));

  const cleaned = [];
  for (const line of lines) {
    if (!line) {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1] === '') {
        continue;
      }
      cleaned.push('');
    } else {
      cleaned.push(line);
    }
  }

  const result = cleaned.join('\n').trim();
  return result.length > 0 ? result : null;
}

async function downloadWithLimit(url, timeout) {
  const response = await axios.get(url, {
    headers: { ...BROWSER_HEADERS, Accept: '*/*' },
    timeout,
    maxRedirects: MAX_REDIRECTS,
    responseType: 'stream',
    decompress: true,
    validateStatus: () => true
  });

  if (response.status >= 400) {
    response.data.destroy();
    const error = new Error(`HTTP_STATUS_${response.status}`);
    error.status = response.status;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    response.data.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_WHITEPAPER_BYTES) {
        response.data.destroy();
        reject(new Error('SIZE_LIMIT_EXCEEDED'));
        return;
      }
      chunks.push(chunk);
    });

    response.data.on('end', () => {
      resolve({
        buffer: Buffer.concat(chunks),
        headers: response.headers
      });
    });

    response.data.on('error', (error) => {
      reject(error);
    });
  });
}

async function fetchWhitepaperText(url) {
  try {
    const { buffer, headers } = await downloadWithLimit(url, WHITEPAPER_TIMEOUT_MS);
    const contentType = headers && headers['content-type'] ? headers['content-type'] : '';
    const isPdf = url.toLowerCase().endsWith('.pdf') || contentType.toLowerCase().includes('application/pdf');

    if (isPdf) {
      const parsed = await pdfParse(buffer);
      return normalizeWhitespace(parsed.text);
    }

    let charset = 'utf-8';
    try {
      charset = parseCharset(contentType);
    } catch (error) {
      charset = 'utf-8';
    }

    let decoded;
    try {
      const decoder = new TextDecoder(charset, { fatal: false });
      decoded = decoder.decode(buffer);
    } catch (error) {
      const fallbackDecoder = new TextDecoder('utf-8', { fatal: false });
      decoded = fallbackDecoder.decode(buffer);
    }

    const $ = cheerio.load(decoded);
    $('script, style, noscript').remove();
    const extractedText = $('body').text();
    return normalizeWhitespace(extractedText);
  } catch (error) {
    if (error.message === 'SIZE_LIMIT_EXCEEDED') {
      return null;
    }

    if (error.status && error.status >= 400) {
      return null;
    }

    return null;
  }
}

app.get('/scrape', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ ok: false, error: 'Parameter "url" fehlt.', result: null });
  }

  let html;
  try {
    html = await fetchCoinMarketCapPage(url);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.message || 'Fehler beim Abrufen der URL.', result: null });
  }

  const extractedLinks = extractLinksFromHtml(html, url);
  const whitepaperText = extractedLinks.whitepaperUrl
    ? await fetchWhitepaperText(extractedLinks.whitepaperUrl)
    : null;

  const result = {
    website: extractedLinks.website,
    whitepaperUrl: extractedLinks.whitepaperUrl,
    whitepaperText,
    coingecko: extractedLinks.coingecko,
    dextools: extractedLinks.dextools
  };

  const missing = [];
  if (!result.website) {
    missing.push('website');
  }
  if (!result.whitepaperUrl) {
    missing.push('whitepaperUrl');
  }

  const timestamp = new Date().toISOString();

  if (missing.length > 0) {
    return res.status(422).json({
      ok: false,
      error: `Abbruch: Pflichtlinks fehlen (${missing.join(', ')})`,
      inputUrl: url,
      scrapedAt: timestamp,
      result
    });
  }

  return res.json({
    ok: true,
    inputUrl: url,
    scrapedAt: timestamp,
    result
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});

module.exports = app;
