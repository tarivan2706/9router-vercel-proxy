export default async function handler(req, res) {
  // 1. Tangkap target URL dari berbagai opsi header
  const targetHeader = req.headers['x-target-url'] || req.headers['x-relay-target'];
  const relayPath = req.headers['x-relay-path'] || '';
  
  let target = targetHeader;
  if (target && relayPath) {
    target = target.endsWith('/') ? target + relayPath.replace(/^\//, '') : target + relayPath;
  }

  if (!target) {
    return res.status(400).json({ 
      error: 'Missing target URL. Header x-target-url, x-relay-target, or x-relay-path is required.' 
    });
  }

  // 2. Daftar Header yang WAJIB DIBUANG agar IP VPS / Identitas Asal Tidak Bocor
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

  // 3. Bangun Header Bersih untuk dikirim ke Target
  const outHeaders = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
  };

  for (const [k, v] of Object.entries(req.headers)) {
    const keyLower = k.toLowerCase();
    if (STRIP.includes(keyLower)) continue;               // Buang header pengenal IP/lokasi
    if (keyLower.startsWith('x-relay-')) continue;        // Buang header kontrol relay
    if (keyLower === 'x-target-url') continue;            // Buang header target
    outHeaders[k] = v;
  }

  try {
    // 4. Baca Body dengan Aman (Mencegah Error 520 / POST Body Lost)
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

    // 5. Kirim Request ke Target API
    const response = await fetch(target, {
      method: req.method,
      headers: outHeaders,
      body,
      redirect: 'follow',
    });

    // 6. Forward Response Status & Response Headers (Skip Hop-by-Hop)
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // 7. Teruskan Streaming (Penting untuk Hermes/9Router) atau Send Buffer
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
