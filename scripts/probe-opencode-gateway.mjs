import { readFileSync, existsSync } from 'node:fs';

function getOpenCodeKey() {
  const files = [
    '.env.local',
    'C:\\Workspace\\Babel-private\\babel-cli\\.env',
    'C:\\Workspace\\Babel-public-live\\babel-cli\\.env',
  ];
  for (const file of files) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          if (key === 'OPENCODE_API_KEY' || key === 'OPENCODE_ZEN_API_KEY' || key === 'OPENCODE_CONSOLE_API_KEY') {
            return { keyName: key, value: val, file };
          }
        }
      }
    }
  }
  return null;
}

const keyInfo = getOpenCodeKey();

async function probeEndpoint(url, token, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, ok: res.ok, json, rawLength: text.length };
  } catch (e) {
    return { status: -1, ok: false, error: e.message };
  }
}

async function run() {
  if (!keyInfo) {
    console.log('No OpenCode key found in any env file.');
    return;
  }
  console.log(`Found key named ${keyInfo.keyName} in ${keyInfo.file}. Key length: ${keyInfo.value.length}`);

  // Test Zen
  console.log('Testing OpenCode Zen gateway...');
  const zen1 = await probeEndpoint('https://opencode.ai/zen/v1/models', keyInfo.value);
  console.log('Zen v1/models:', zen1.status, zen1.ok);

  const zen2 = await probeEndpoint('https://opencode.ai/zen/models', keyInfo.value);
  console.log('Zen models:', zen2.status, zen2.ok);

  // Test Console
  console.log('Testing OpenCode Console gateway...');
  const con1 = await probeEndpoint('https://api.opencode.ai/v1/models', keyInfo.value);
  console.log('Console v1/models:', con1.status, con1.ok);

  const con2 = await probeEndpoint('https://api.opencode.ai/models', keyInfo.value);
  console.log('Console models:', con2.status, con2.ok);

  let activeResult = null;
  let mode = 'UNKNOWN';
  if (zen1.ok) {
    activeResult = zen1;
    mode = 'ZEN';
  } else if (zen2.ok) {
    activeResult = zen2;
    mode = 'ZEN';
  } else if (con1.ok) {
    activeResult = con1;
    mode = 'CONSOLE';
  } else if (con2.ok) {
    activeResult = con2;
    mode = 'CONSOLE';
  }

  console.log('\n========================================');
  console.log(`OPENCODE_GATEWAY_MODE=${mode}`);
  console.log(`credential_valid=${activeResult ? 'yes' : 'no'}`);
  console.log(`discovery_valid=${activeResult ? 'yes' : 'no'}`);
  if (activeResult?.json) {
    const rawList = Array.isArray(activeResult.json.data)
      ? activeResult.json.data
      : (Array.isArray(activeResult.json.models) ? activeResult.json.models : activeResult.json);
    console.log('Discovered models payload type:', typeof rawList, Array.isArray(rawList) ? rawList.length : 'not-array');
    if (Array.isArray(rawList)) {
      const ids = rawList.map(m => typeof m === 'string' ? m : (m.id || m.name || JSON.stringify(m)));
      console.log('All Discovered Model IDs:');
      console.log(JSON.stringify(ids, null, 2));
    } else {
      console.log('Payload:', activeResult.json);
    }
  }
  console.log('========================================\n');
}

run();
