const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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

const repoDomains = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org'
]);

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache'
};

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const absolute = new URL(rawUrl, baseUrl);
    absolute.hash = '';
    return absolute.toString();
  } catch (error) {
    return null;
  }
}

function classifyLink(urlObj, textContent = '') {
  const hostname = urlObj.hostname.toLowerCase();
  const href = urlObj.toString().toLowerCase();
  const text = textContent.toLowerCase();

  if (
    href.includes('whitepaper') ||
    href.includes('litepaper') ||
    text.includes('whitepaper') ||
    text.includes('litepaper') ||
    href.endsWith('.pdf')
  ) {
    return 'whitepaper';
  }

  if (explorerDomains.has(hostname) || hostname.endsWith('.etherscan.io')) {
    return 'explorer';
  }

  if (hostname in socialDomains) {
    return `social:${socialDomains[hostname]}`;
  }

  if (repoDomains.has(hostname)) {
    return 'repository';
  }

  return 'other';
}

function scrapeLinksFromHtml(html, pageUrl) {
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
    whitepaper: null,
    explorers: [],
    socials: [],
    repositories: [],
    others: []
  };

  const seen = new Set();

  for (const item of anchors) {
    const { url, text } = JSON.parse(item);
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    const urlObj = new URL(url);
    const classification = classifyLink(urlObj, text);

    if (classification === 'whitepaper' && !result.whitepaper) {
      result.whitepaper = url;
      continue;
    }

    if (classification === 'explorer') {
      result.explorers.push(url);
      continue;
    }

    if (classification.startsWith('social:')) {
      const platform = classification.split(':')[1];
      result.socials.push({ platform, url });
      continue;
    }

    if (classification === 'repository') {
      result.repositories.push(url);
      continue;
    }

    if (!result.website) {
      result.website = url;
      continue;
    }

    result.others.push({ url, text });
  }

  return result;
}

app.get('/scrape', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parameter "url" fehlt.' });
  }

  let response;
  try {
    response = await axios.get(url, { headers, timeout: 15000 });
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    return res.status(status).json({
      error: 'Fehler beim Abrufen der URL.',
      details: error.message
    });
  }

  const data = scrapeLinksFromHtml(response.data, url);

  const missing = [];
  if (!data.website) missing.push('website');
  if (!data.whitepaper) missing.push('whitepaper');

  if (missing.length > 0) {
    return res.status(422).json({
      error: 'Abbruch: Pflichtlinks fehlen',
      missing,
      data
    });
  }

  return res.json({
    inputUrl: url,
    scrapedAt: new Date().toISOString(),
    links: data
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});

module.exports = app;
