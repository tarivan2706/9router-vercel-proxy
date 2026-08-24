export default async function handler(req, res) {
  const target = req.headers['x-target-url'];
  if (!target) {
    return res.status(400).json({ error: 'Missing target URL. Header x-target-url is required.' });
  }

  // Fungsi pembantu untuk menembak fetch
  const executeFetch = async (fetchUrl, options) => {
    return await fetch(fetchUrl, {
      ...options,
      redirect: 'follow',
    });
  };

  try {
    // 1. Tangani Request Body
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

    // 2. Kumpulkan Header
    const headers = { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
    };

    for (const [key, value] of Object.entries(req.headers)) {
      if (!['host', 'x-forwarded-for', 'x-real-ip', 'x-target-url', 'x-vercel-proxy-signature', 'content-length'].includes(key.toLowerCase())) {
        headers[key] = value;
      }
    }

    const fetchOptions = { method: req.method, headers, body };

    // 3. Eksekusi request utama
    let response = await executeFetch(target, fetchOptions);

    // 4. Fallback ke Jina Reader (HANYA jika GET request & tembak target gagal/ter-block 403/503)
    if (!response.ok && req.method === 'GET' && [403, 502, 503].includes(response.status)) {
      try {
        const jinaUrl = `https://r.jina.ai/${target}`;
        const jinaResponse = await executeFetch(jinaUrl, {
          method: 'GET',
          headers: { 'User-Agent': headers['User-Agent'] }
        });

        if (jinaResponse.ok) {
          response = jinaResponse; // Gunakan hasil dari Jina jika berhasil
        }
      } catch (jinaErr) {
        // Jika Jina gagal, tetap gunakan response original
      }
    }

    // 5. Forward HTTP Status & Response Headers
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // 6. Stream Response (untuk AI Streaming) atau Send Buffer
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