#!/usr/bin/env -S zx --install
// Docs: https://google.github.io/zx/api

// fritzconnection (python) can't connect from the internet: https://github.com/kbr/fritzconnection/issues/178

// Run with `zx --install devices.mjs` to install dependencies (included in #! above)
import 'dotenv/config' // loads environment variables from .env
// console.log(process.env)

const help = () => {
  console.log(`Usage: ./devices.mjs [OPTION]...

Login data can be given as arguments (not recommended),
read from environment variables HOST, USER and PASS,
or, if nothing is set, it will prompt you.

Options:
  --loop=SEC    Run in a loop with SEC seconds of sleep each iteration.
  --host=HOST   FritzBox hostname including port, e.g., foobarbaz.myfritz.net:46390.
  --user=USER   FritzBox username.
  --pass=PASS   FritzBox password.
  --verbose     Verbose mode (shows each command and its output; off by default).
  --help        Show this usage information.
`);
}
if (argv.help) {
  help()
  process.exit(0)
}
$.verbose = argv.verbose;

// zx has `question` for prompts, but there's no option to hide passwords.
// Use `ask('Prompt: ', true)` instead to show * on input.
// Adapted from https://gist.github.com/colgatto/22a2933889eda0a51645374b5bd70e3b
// Could also use https://github.com/enquirer/enquirer now that I introduced deps for dotenv.
const readline = require('readline')
const ask = (query, hidden = false) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  if(hidden){
    let t = true
    rl._writeToOutput = (a) => {
      if(t){
        rl.output.write(a)
        t = false;
      } else {
        rl.output.write('*')
      }
    }
  }
  return new Promise(resolve => rl.question(query, ans => {
      if(hidden) rl.output.write('\n\r')
      rl.close()
      resolve(ans)
  }))
}

const sec = parseInt(argv.loop)
const host = argv.host || process.env.HOST || await question('Hostname including port: ') || process.exit(1)
const user = argv.user || process.env.USER || await question('Username: ') || process.exit(1)
const pass = argv.pass || process.env.PASS || await ask('Password: ', true) || process.exit(1)

// await spinner('working...', () => $`sleep 2`)

while(true) {
  console.log(new Date().toLocaleString('de'));

  const headers = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7",
    "cache-control": "no-cache",
    "content-type": "application/x-www-form-urlencoded",
    "pragma": "no-cache",
    "sec-ch-ua": "\"Chromium\";v=\"116\", \"Not)A;Brand\";v=\"24\", \"Google Chrome\";v=\"116\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
  let sid = null;
  const getData = (fb) => async (page, json = true) => {
    // check if sid still valid and login+challenge if not
    // http://www.apfel-z.net/artikel/Fritz_Box_API_via_curl_wget/
    if (!sid) {
      // console.log('> Login <')
      // console.time('login');
      const sid_get = await (await fetch(`https://${fb}/login_sid.lua`, { headers, "method": "GET" })).text();
      // console.log(sid_get);
      const xml_sid = t => t.match(/<SID>(.*)<\/SID>/)[1];
      const xml_cha = t => t.match(/<Challenge>(.*)<\/Challenge>/)[1];
      if (xml_sid(sid_get) == '0000000000000000') {
        const challenge = xml_cha(sid_get);
        // console.error('Not logged in anymore! Challenge:', challenge);
        const response = (await $`echo -n "${challenge}-${pass}" | iconv --from-code=UTF-8 --to-code=UTF-16LE | md5sum | sed  -e 's/ .*//'`).toString().trim();
        // console.log('Response:', response);
        const r = await (await fetch(`https://${fb}/login_sid.lua`, { headers, "method": "POST",
          "body": `response=${challenge}-${response}&username=${user}`,
        })).text();
        // console.log(r);
        sid = xml_sid(r);
        // console.log('New SID:', sid);
      }
      // console.timeEnd('login');
    }
    console.time(page);
    const r = await fetch(`https://${fb}/data.lua`, {
      headers,
      "body": `xhr=1&sid=${sid}&page=${page}&lang=de&xhrId=all&initial=`,
      "method": "POST"
    });
    console.timeEnd(page);
    return await (json ? r.json() : r.text());
  };

  const fb = getData(host);

  // console.log('> Devices <')
  console.log((await fb('overview')).data.net.devices.map(x => `${x.name} (${x.desc})`)); // 3s
  // console.log((await fb('netDev')).data.active.map(x => x.name)); // 5s
  // icons: green = connected, globe = connected and using internet sending/receiving data; https://www.gutefrage.net/frage/was-bedeuten-fritzbox-icons

  // console.log('> Online-Zähler <')
  const netCnt = await fb('netCnt', false); // 0.5s
  const netCntData = netCnt.split('\n').find(x => x.startsWith('const data = ')).replace('const data = ', '').replace(';', '');
  const r = JSON.parse(netCntData);
  // console.log(r);
  const calc = period => {
    const mb = (high, low) => {
      high = parseInt(high || "0", 10);
      low = parseInt(low || "0", 10);
      const bytes = high * 4294967296 + low;
      return Math.round(bytes / 1000000);
    }
    const outgoing = mb(period.BytesSentHigh, period.BytesSentLow);
    const incoming = mb(period.BytesReceivedHigh, period.BytesReceivedLow);
    const total = outgoing + incoming; 
    return {total, outgoing, incoming};
  }
  console.log('Today', calc(r.Today));
  // console.log('Yesterday', calc(r.Yesterday));
  console.log();
  if (sec)
    await sleep(sec*1000)
  else
    break
}
