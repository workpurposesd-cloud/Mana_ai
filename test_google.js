import * as cheerio from 'cheerio';

async function testLite() {
  const params = new URLSearchParams({ q: 'latest technology news' });
  const res = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: params.toString()
  });
  console.log('Lite status:', res.status);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];
  $('a.result-link').each((i, el) => {
    results.push({
      title: $(el).text().trim(),
      href: $(el).attr('href'),
      snippet: $(el).closest('tr').next().find('.result-snippet').text().trim()
    });
  });
  console.log('Lite results count:', results.length);
  results.slice(0, 3).forEach(r => console.log('>', r.title, '|', r.href));
}

testLite();
