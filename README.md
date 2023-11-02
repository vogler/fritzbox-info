fritzbox-info
=============

CLI tool for AVM FritzBox API to

- list the currently connected devices
- show internet usage

There's already [fritzconnection](https://github.com/kbr/fritzconnection) to communicate with the FritzBox API, but I didn't like it since it was slow and doesn't work from outside the local network ([issue](https://github.com/kbr/fritzconnection/issues/178)).

## Usage

Install [zx](https://google.github.io/zx/getting-started#install).

```
$ ./devices.mjs --help
Usage: ./devices.mjs [OPTION]...

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
```

```console
$ ./devices.mjs
Password: ***********
2.11.2023, 11:47:27
overview: 1.516s
[
  'Echo-Show-5 (5 GHz)',
  'FireTV-Stick-4K-Max (5 GHz)',
  'HTC-Nexus9 (5 GHz)',
  'Pixel2XL (5 GHz)',
  'Ralfs-Air-3 (5 GHz)',
  'Ring-Video-Doorbell-Wired (2,4 GHz)',
  'Sonoff-S20-LED-Strip (2,4 GHz)',
  'Sonoff-S26-Desk (2,4 GHz)',
  'Sonoff-S26-Genius (2,4 GHz)',
  'Sonoff-Touch-Bad (2,4 GHz)',
  'localhost (5 GHz)',
  'Hue-Bridge (undefined)',
  'rpi3 (undefined)',
  'rpi4 (undefined)'
]
netCnt: 224.482ms
Today { total: 2400, outgoing: 1112, incoming: 1288 }
```
