const https = require('https');

// This quiz adds subscribers to NEW app-funnel segments, matched by NAME
// (no segment IDs needed). Create segments in Flodesk named like:
//
//   App Quiz - Mild General      App Quiz - Mild ADHD      App Quiz - Mild GLP-1
//   App Quiz - Moderate General  App Quiz - Moderate ADHD  App Quiz - Moderate GLP-1
//   App Quiz - Severe General    App Quiz - Severe ADHD    App Quiz - Severe GLP-1
//
// Matching is case-insensitive and only requires the name to contain
// "app quiz" + the band word (mild/moderate/severe) + the audience word
// (general/adhd/glp). Punctuation and extra words don't matter.
//
// Optional catch-all: any segment containing "app funnel" gets EVERY
// subscriber from this quiz (e.g. "App Quiz - App Funnel").
//
// If no matching segments exist yet, the subscriber is still added to
// Flodesk with no segments — a lead is never lost.

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { email, segment, wls } = JSON.parse(event.body);
    const API_KEY = process.env.FLODESK_API_KEY;

    const authHeader = 'Basic ' + Buffer.from(API_KEY + ':').toString('base64');

    const flodeskRequest = (method, path, bodyObj) => new Promise((resolve, reject) => {
      const payload = bodyObj ? JSON.stringify(bodyObj) : null;
      const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request({
        hostname: 'api.flodesk.com',
        path,
        method,
        headers
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

    // segment arrives as e.g. "moderate adhd", "mild general", "severe glp1"
    const [band, audience] = (segment || '').toLowerCase().split(' ');
    const audienceWord = audience === 'glp1' ? 'glp' : audience; // matches "GLP-1", "GLP1", "glp"

    const segmentIds = [];
    try {
      const segRes = await flodeskRequest('GET', '/v1/segments?per_page=100');
      const parsed = JSON.parse(segRes.body);
      for (const s of (parsed.data || [])) {
        if (!s.name) continue;
        const name = s.name.toLowerCase();
        const isAppQuiz = name.includes('app quiz');
        const isCatchAll = name.includes('app funnel');
        const matchesScore = band && audienceWord &&
          name.includes(band) && name.includes(audienceWord);
        if ((isAppQuiz && matchesScore) || isCatchAll) {
          segmentIds.push(s.id);
        }
      }
    } catch (e) { /* non-fatal — never lose the subscriber */ }

    const baseBody = {
      email,
      ...(segmentIds.length ? { segment_ids: segmentIds } : {})
    };

    let data = await flodeskRequest('POST', '/v1/subscribers', {
      ...baseBody,
      ...(wls ? { custom_fields: { wls } } : {})
    });

    // Safety net: if Flodesk rejects the custom field (e.g. 'wls' key
    // not created yet), retry without it so the subscriber is never lost.
    if (wls && data.status !== 200 && data.status !== 201) {
      data = await flodeskRequest('POST', '/v1/subscribers', baseBody);
    }

    return {
      statusCode: data.status === 200 || data.status === 201 ? 200 : data.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: data.body
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
