const MFAPI_BASE_URL = 'https://api.mfapi.in/mf';
const https = require('https');

function fetchWithSystemTls(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: 'application/json' },
      rejectUnauthorized: false
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        json: async () => JSON.parse(text)
      }));
    });
    request.setTimeout(15000, () => request.destroy(new Error('MFAPI request timed out')));
    request.on('error', reject);
  });
}

async function requestMfApi(url) {
  try {
    return await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    const code = error?.cause?.code || error?.code;
    if (!['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED'].includes(code)) {
      throw error;
    }
    return fetchWithSystemTls(url);
  }
}

async function fetchMfApi(path) {
  const response = await requestMfApi(`${MFAPI_BASE_URL}${path}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `MFAPI returned ${response.status}`);
  }
  return body;
}

function mfDateToIso(value) {
  const match = String(value || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function selectNavAsOf(data, targetDate) {
  return (data || [])
    .map(entry => ({ ...entry, isoDate: mfDateToIso(entry.date) }))
    .filter(entry => entry.isoDate && entry.isoDate <= targetDate && Number(entry.nav) > 0)
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate))[0] || null;
}

function isSchemeCode(value) {
  return /^\d+$/.test(String(value || ''));
}

async function resolveNav(schemeCode, investmentDate) {
  if (!isSchemeCode(schemeCode)) {
    throw new Error('A valid MFAPI scheme code is required for mutual funds');
  }

  const history = await fetchMfApi(`/${schemeCode}?endDate=${encodeURIComponent(investmentDate)}`);
  const targetDate = String(investmentDate || '');
  const historicalEntry = selectNavAsOf(history?.data, targetDate);

  if (historicalEntry) {
    return { nav: Number(historicalEntry.nav), navDate: historicalEntry.isoDate, source: 'history' };
  }

  const latest = await fetchMfApi(`/${schemeCode}/latest`);
  const latestEntry = latest?.data?.find(entry => Number(entry.nav) > 0);
  if (!latestEntry) throw new Error('MFAPI returned no usable NAV for this scheme');

  return {
    nav: Number(latestEntry.nav),
    navDate: mfDateToIso(latestEntry.date),
    source: 'latest'
  };
}

module.exports = { fetchMfApi, isSchemeCode, mfDateToIso, selectNavAsOf, resolveNav };