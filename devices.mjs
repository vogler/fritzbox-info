#!/usr/bin/env -S zx --install
// Docs: https://google.github.io/zx/api

// fritzconnection (python) can't connect from the internet: https://github.com/kbr/fritzconnection/issues/178

import { log } from 'node:console';
import { fs, $, chalk, question } from 'zx';
// Run with `zx --install devices.mjs` to install dependencies (included in #! above)
import 'dotenv/config' // loads environment variables from .env
// log(process.env)

const help = () => {
  log(`Usage: ./devices.mjs [OPTIONS] [COMMANDS]...

Login data can be given as arguments (not recommended),
read from environment variables FBHOST, FBUSER and FBPASS,
or, if nothing is set, it will prompt you.

Options:
  --host=FBHOST  FritzBox hostname including port, e.g., foobarbaz.myfritz.net:46390.
  --user=FBUSER  FritzBox username.
  --pass=FBPASS  FritzBox password.
  --loop=SEC     Run in a loop with SEC seconds of sleep each iteration. Default is to run commands just once. Option is ignored for mutation commands like --add_mac.
  --verbose      Verbose mode (shows each command and its output; off by default).
  --help         Show this usage information.

Commands:
  --add_mac=MAC  Add a device by its MAC address and quit.
  --overview     Overview of devices and ??.
  --devices      Detailed list of devices.
  --counter      Online counter / statistics.
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

// option parsing
const sec = parseInt(argv.loop)
const host = argv.host || process.env.FBHOST || await question('Hostname including port: ') || process.exit(1)
const user = argv.user || process.env.FBUSER || await question('Username: ') || process.exit(1)
const pass = argv.pass || process.env.FBPASS || await ask('Password: ', true) || process.exit(1)

log(new Date().toLocaleString('de'));

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

const getData = (host) => async (page, json = true) => {
  // check if sid still valid and login+challenge if not
  // http://www.apfel-z.net/artikel/Fritz_Box_API_via_curl_wget/
  if (!sid) {
    // log('> Login <')
    // console.time('login');
    const sid_get = await (await fetch(`https://${host}/login_sid.lua`, { headers, "method": "GET" })).text();
    // log(sid_get);
    const xml_sid = t => t.match(/<SID>(.*)<\/SID>/)[1];
    const xml_cha = t => t.match(/<Challenge>(.*)<\/Challenge>/)[1];
    if (xml_sid(sid_get) == '0000000000000000') {
      const challenge = xml_cha(sid_get);
      // console.error('Not logged in anymore! Challenge:', challenge);
      const response = (await $`echo -n "${challenge}-${pass}" | iconv --from-code=UTF-8 --to-code=UTF-16LE | md5sum | sed  -e 's/ .*//'`).toString().trim();
      // log('Response:', response);
      const r = await (await fetch(`https://${host}/login_sid.lua`, { headers, "method": "POST",
        "body": `response=${challenge}-${response}&username=${user}`,
      })).text();
      // log(r);
      sid = xml_sid(r);
      // log('New SID:', sid);
    }
    // console.timeEnd('login');
  }
  console.time(page);
  const r = await fetch(`https://${host}/data.lua`, {
    headers,
    "body": `xhr=1&sid=${sid}&page=${page}&lang=de&xhrId=all&initial=`,
    "method": "POST"
  });
  console.timeEnd(page);
  const data = await (json ? r.json() : r.text());
  const ext = json ? 'json' : 'html';
  // const dir = 'data/' + new Date().toISOString(); // UTC: 2025-06-10T13:34:36.780Z
  const dir = 'data/' + new Date().toISOString().split('T')[0]; // keeping data once per day is enough for now
  fs.ensureDirSync(dir);
  const filename = `${dir}/${page}.${ext}`;
  if (json) fs.writeJsonSync(filename, data, { spaces: 2 });
  else fs.writeFileSync(filename, data, { spaces: 2 });
  return data;
};

const fb = getData(host);

// mutating commands (can not run with --loop)
if (argv.add_mac) {
  const mac = argv.add_mac;
  log('Adding device with MAC', mac);
  const formData = mac.split(':').map((i,v) => `mac${i}=${v}`).join('&') + `&mac=${encodeURIComponent(mac)}`;
  const res = fb(`wKey&${formData}`).data;
  if (res?.add_mac == 'ok') {
    log('Success!');
    process.exit(0);
  } else {
    console.error('Failed!');
    process.exit(1);
  }
}

// non-mutating commands
const overview = async () => {
  const r = await fb('overview'); // 3s
  const d = r.data;
  // just includes name, state and connection, not IP or MAC
  const devices = d.net.devices.map(x => `${x.name} (${x.desc})`);
  const con = d.internet.connections.find(x => x.active);
  log({
    fritzbox: d.fritzos.Productname,
    fritzos: d.fritzos.nspver,
    lan: d.lan.txt,
    callsToday: d.foncalls.callsToday,
    dect: d.dect.txt,
    active_devices: d.net.active_count,
    isp: con.provider_id,
    ipv4: con.ipv4.ip,
    ipv6: con.ipv6.ip,
    downstream: con.downstream,
    upstream: con.upstream,
    uplink: con.ethernet_port_name,
    devices,
  });
};

const devices = async () => {
  log((await fb('netDev')).data.active.map(x => x.name)); // 5s
  // icons: green = connected, globe = connected and using internet sending/receiving data; https://www.gutefrage.net/frage/was-bedeuten-fritzbox-icons
  // echo "$(echo 'name,mac,ipv4.ip,port'; cat netDev.json | jq -r '.data | ([.active, .passive] | add)[] | [.name, .mac, .ipv4.ip, .port] | @csv')" | xsv table
};

const counter = async () => {
  const netCnt = await fb('netCnt', false); // 0.5s
  const netCntData = netCnt.split('\n').find(x => x.startsWith('const data = ')).replace('const data = ', '').replace(';', '');
  const r = JSON.parse(netCntData);
  // log(r);
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
  log('Today', calc(r.Today));
  // log('Yesterday', calc(r.Yesterday));
};

const cmd = async f => {
  if (argv[f.name]) {
    log(`> ${f.name} <`)
    await f();
    log();
  }
};

while(true) {
  await cmd(overview);
  await cmd(devices);
  await cmd(counter);
  if (sec)
    await sleep(sec*1000);
  else
    break;
}

log('Done');
