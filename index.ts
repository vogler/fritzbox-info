#!/usr/bin/env bun .
// Docs: https://google.github.io/zx/api
// https://google.github.io/zx/typescript

// fritzconnection (python) can't connect from the internet: https://github.com/kbr/fritzconnection/issues/178

import { log } from 'node:console';
import { $, argv, fs, chalk, question, sleep } from 'zx';
import { password } from '@inquirer/prompts'; // since zx has no prompt to hide password...
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

// option parsing
const sec = parseInt(argv.loop)
const host = argv.host || process.env.FBHOST || await question('Hostname including port: ') || process.exit(1)
const user = argv.user || process.env.FBUSER || await question('Username: ') || process.exit(1)
const pass = argv.pass || process.env.FBPASS || await password({ message: 'Password:', mask: true }) || process.exit(1)

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

let sid: string | undefined;

const getData = (host: string) => async (page: string, json = true) => {
  // check if sid still valid and login+challenge if not
  // http://www.apfel-z.net/artikel/Fritz_Box_API_via_curl_wget/
  if (!sid) {
    // log('> Login <')
    // console.time('login');
    const sid_get = await (await fetch(`https://${host}/login_sid.lua`, { headers, "method": "GET" })).text();
    // log(sid_get);
    const xml_sid = (t: string) => t.match(/<SID>(.*)<\/SID>/)?.[1];
    const xml_cha = (t: string) => t.match(/<Challenge>(.*)<\/Challenge>/)?.[1];
    if (xml_sid(sid_get) == '0000000000000000') {
      const challenge = xml_cha(sid_get);
      // console.error('Not logged in anymore! Challenge:', challenge);
      const response = (await $`echo -n "${challenge}-${pass}" | iconv --from-code=UTF-8 --to-code=UTF-16LE | md5sum | sed  -e 's/ .*//'`).toString().trim();
      // log('Response:', response);
      const r = await (await fetch(`https://${host}/login_sid.lua`, {
        headers, "method": "POST",
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

function formatDurationAgo(ms: number): string {
  const seconds = ms / 1000;
  const units = [
    { label: "d", value: 86400 },
    { label: "h", value: 3600 },
    { label: "m", value: 60 },
    { label: "s", value: 1 },
  ];

  for (const unit of units) {
    if (seconds >= unit.value) {
      const count = Math.floor(seconds / unit.value);
      return `${count}${unit.label} ago`;
    }
  }
  return "just now";
}

// mutating commands (can not run with --loop)
if (argv.add_mac) {
  const mac = argv.add_mac;
  log('Adding device with MAC', mac);
  const formData = mac.split(':').map((i: number, v: string) => `mac${i}=${v}`).join('&') + `&mac=${encodeURIComponent(mac)}`;
  const r = await fb(`wKey&${formData}`);
  const d = r.data;
  if (d.add_mac == 'ok') {
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
  const devices = d.net.devices.map(x => `${x.name} (${x.desc ?? x.type})`);
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
  const r = await fb('netDev'); // 5s
  const d = r.data;
  // const devices = d.active.map(x => x.name);
  // icons: green = connected, globe = connected and using internet sending/receiving data; https://www.gutefrage.net/frage/was-bedeuten-fritzbox-icons
  // echo "$(echo 'name,mac,ipv4.ip,port'; cat netDev.json | jq -r '.data | ([.active, .passive] | add)[] | [.name, .mac, .ipv4.ip, .port] | @csv')" | xsv table
  const max_ip = Math.max(...d.active.map(d => d.ipv4.ip.length));
  const p = d => {
    const ts_lastused = Number(d.ipv4.lastused) * 1000;
    const ago = formatDurationAgo(Date.now() - ts_lastused);
    log(chalk.gray(d.mac), d.ipv4.ip.padEnd(max_ip), chalk.blue(d.name), ago, d.properties.map(x => x.txt), d.type, chalk.yellow(d.parent.name));
  };
  const f = s => {
    const sortBy = d => Number(d.ipv4.ip.split('.').at(-1));
    const ds = d[s].sort((a, b) => sortBy(a) - sortBy(b));
    log(s, ds.length);
    if (ds.length) log('Indirectly connected devices:', ds.filter(d => d.parent.name).length);
    ds.map(p);
    if (ds.length) log();
  };
  f('active');
  f('passive'); // empty by default; prob. need to pass some arg to include passive devices
  log('countpassive', d.countpassive);
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
    return { total, outgoing, incoming };
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

while (true) {
  await cmd(overview);
  await cmd(devices);
  await cmd(counter);
  if (sec)
    await sleep(sec * 1000);
  else
    break;
}
