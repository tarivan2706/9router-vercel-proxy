export default async function handler(req, res) {
  // 1. Ambil target & path dari header relay atau target baku
  const targetHeader = req.headers['x-relay-target'] || req.headers['x-target-url'];
  const relayPath = req.headers['x-relay-path'] || '';
  
  let target = targetHeader;
  if (target && relayPath) {
    target = target.endsWith('/') ? target + relayPath.replace(/^\//, '') : target + relayPath;
  }

  if (!target) {
    return res.status(400).json({ 
      error: 'Missing target URL. Header x-relay-target or x-target-url is required.' 
    });
  }

  // 2. Header privacy & pengenal yang WAJIB dibuang
  const STRIP = [
    'host',
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
    'x-vercel-forwarded-for',
    'x-vercel-id',
    'x-vercel-ip-country',
    'x-vercel-proxy-signature',
    'cf-connecting-ip',
    'true-client-ip',
    'content-length'
  ];

  // 3. Salin header penting (Content-Type, Authorization, Cookie, dll)
  const outHeaders = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
  };

  for (const [k, v] of Object.entries(req.headers)) {
    const keyLower = k.toLowerCase();
    if (STRIP.includes(keyLower)) continue;
    if (keyLower.startsWith('x-relay-')) continue;
    if (keyLower === 'x-target-url') continue;
    outHeaders[k] = v;
  }

  try {
    // 4. Baca Body dengan aman (support POST, PUT, PATCH, DELETE)
    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body) {
        body = typeof req.body === 'string' || Buffer.isBuffer(req.body) 
          ? req.body 
          : JSON.stringify(req.body);
      } else {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
    }

    // 5. Kirim Fetch dengan method asli (req.method)
    const response = await fetch(target, {
      method: req.method,
      headers: outHeaders,
      body,
      redirect: 'follow',
    });

    // 6. Forward HTTP Status & Response Headers balik ke client
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // 7. Stream Response (Krusial untuk Real-time AI Streaming / Hermes)
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    } else {
      const buf = await response.arrayBuffer();
      return res.send(Buffer.from(buf));
    }

  } catch (e) {
    return res.status(502).json({ error: 'Proxy Error: ' + e.message });
  }
}
