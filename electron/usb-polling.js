/* Local Keymap - the polling rate each USB keyboard asks for, read from its USB descriptors.
 * The host polls an interrupt endpoint exactly as often as its descriptor says (bInterval, which
 * means milliseconds on low/full-speed USB and 2^(n-1) x 125 us on high-speed USB), so this is the
 * keyboard's real polling rate, not an estimate.
 *  - Windows: a short PowerShell script asks the USB hub driver for each device's descriptors
 *    (the same read-only requests Windows' USBView makes).
 *  - Linux: sysfs (/sys/bus/usb/devices).
 *  - macOS: not available to apps; the key press test is used instead. */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/** bInterval + bus speed -> polling period in ms (hosts round full-speed periods down to a power of 2). */
function periodMs(bInterval, speed) {
  if (!(bInterval > 0)) return null;
  if (speed === 'high' || speed === 'super') return 0.125 * 2 ** (Math.min(bInterval, 16) - 1);
  return 2 ** Math.floor(Math.log2(bInterval));
}

/** devices: [{vendorId, productId, product, speed, interfaces: [{number, cls, subclass, protocol, endpoints: [{address, attributes, bInterval}]}]}]
 *  -> keyboards with their polling rate (the keyboard interface's IN endpoint, else the fastest HID IN endpoint). */
function summarize(devices) {
  const out = [];
  for (const d of devices) {
    const hid = (d.interfaces || []).filter((i) => i.cls === 3);
    if (!hid.length) continue;
    const eps = [];
    for (const i of hid) {
      for (const e of i.endpoints || []) {
        if ((e.attributes & 3) !== 3 || !(e.address & 0x80)) continue; // interrupt IN only
        const ms = periodMs(e.bInterval, d.speed);
        if (ms) eps.push({ iface: i.number, keyboard: i.protocol === 1, bInterval: e.bInterval, ms });
      }
    }
    if (!eps.length) continue;
    const kb = eps.filter((e) => e.keyboard);
    const pick = (kb.length ? kb : eps).reduce((a, b) => (b.ms < a.ms ? b : a));
    out.push({
      vendorId: d.vendorId, productId: d.productId, product: d.product || '', speed: d.speed,
      keyboard: kb.length > 0, intervalMs: pick.ms, rate: Math.round(1000 / pick.ms), bInterval: pick.bInterval,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Linux
function readLinux() {
  const base = '/sys/bus/usb/devices';
  const rd = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch (_) { return ''; } };
  const SPEED = { '1.5': 'low', 12: 'full', 480: 'high' };
  const devices = [];
  for (const name of fs.readdirSync(base)) {
    if (name.includes(':')) continue;
    const dir = path.join(base, name);
    const vid = parseInt(rd(path.join(dir, 'idVendor')), 16);
    if (!Number.isFinite(vid)) continue;
    const mbps = rd(path.join(dir, 'speed'));
    const d = {
      vendorId: vid, productId: parseInt(rd(path.join(dir, 'idProduct')), 16), product: rd(path.join(dir, 'product')),
      speed: SPEED[mbps] || (+mbps >= 5000 ? 'super' : 'full'), interfaces: [],
    };
    for (const ifName of fs.readdirSync(dir).filter((n) => n.startsWith(`${name}:`))) {
      const ifDir = path.join(dir, ifName);
      if (rd(path.join(ifDir, 'bAlternateSetting')) !== '0' && rd(path.join(ifDir, 'bAlternateSetting')) !== '') continue;
      const i = {
        number: parseInt(rd(path.join(ifDir, 'bInterfaceNumber')), 16),
        cls: parseInt(rd(path.join(ifDir, 'bInterfaceClass')), 16),
        subclass: parseInt(rd(path.join(ifDir, 'bInterfaceSubClass')), 16),
        protocol: parseInt(rd(path.join(ifDir, 'bInterfaceProtocol')), 16),
        endpoints: [],
      };
      for (const ep of fs.readdirSync(ifDir).filter((n) => /^ep_[0-9a-f]{2}$/i.test(n))) {
        const epDir = path.join(ifDir, ep);
        i.endpoints.push({
          address: parseInt(rd(path.join(epDir, 'bEndpointAddress')), 16),
          attributes: parseInt(rd(path.join(epDir, 'bmAttributes')), 16),
          bInterval: parseInt(rd(path.join(epDir, 'bInterval')), 16),
        });
      }
      d.interfaces.push(i);
    }
    devices.push(d);
  }
  return devices;
}

// ------------------------------------------------------------------ Windows
const WIN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public class LkEp { public int address { get; set; } public int attributes { get; set; } public int bInterval { get; set; } }
public class LkIf { public int number { get; set; } public int cls { get; set; } public int subclass { get; set; } public int protocol { get; set; } public List<LkEp> endpoints { get; set; } }
public class LkDev { public int vendorId { get; set; } public int productId { get; set; } public string product { get; set; } public string speed { get; set; } public List<LkIf> interfaces { get; set; } }
public static class LkUsb {
  [StructLayout(LayoutKind.Sequential)] struct DEVINFO { public int cbSize; public Guid g; public int DevInst; public IntPtr r; }
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, string e, IntPtr w, int f);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInfo(IntPtr s, int i, ref DEVINFO d);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("setupapi.dll")] static extern bool SetupDiGetDeviceRegistryProperty(IntPtr s, ref DEVINFO d, int p, out int t, byte[] b, int n, out int req);
  [DllImport("cfgmgr32.dll")] static extern int CM_Get_Parent(out int p, int d, int f);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_ID(int d, StringBuilder b, int n, int f);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_Interface_List_Size(out int n, ref Guid g, string id, int f);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_Interface_List(ref Guid g, string id, char[] b, int n, int f);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(SafeFileHandle h, uint c, byte[] i, int ni, byte[] o, int no, out int r, IntPtr ov);
  static Guid USB_DEVICE = new Guid("A5DCBF10-6530-11D2-901F-00C04FB951ED");
  static Guid USB_HUB = new Guid("F18A0E88-C30C-11D0-8815-00A0C906BED8");
  const uint CONN_INFO_EX = 0x220448, GET_DESCRIPTOR = 0x220410;

  static byte[] Descriptor(SafeFileHandle hub, int port, int type, int index, int lang, int len) {
    byte[] b = new byte[12 + len];
    BitConverter.GetBytes(port).CopyTo(b, 0);
    b[4] = 0x80; b[5] = 6; b[6] = (byte)index; b[7] = (byte)type;
    b[8] = (byte)(lang & 255); b[9] = (byte)(lang >> 8); b[10] = (byte)(len & 255); b[11] = (byte)(len >> 8);
    int r;
    if (!DeviceIoControl(hub, GET_DESCRIPTOR, b, b.Length, b, b.Length, out r, IntPtr.Zero) || r <= 12) return null;
    byte[] d = new byte[r - 12];
    Array.Copy(b, 12, d, 0, d.Length);
    return d;
  }

  static string HubPath(int devInst) {
    int parent;
    if (CM_Get_Parent(out parent, devInst, 0) != 0) return null;
    StringBuilder id = new StringBuilder(512);
    if (CM_Get_Device_ID(parent, id, id.Capacity, 0) != 0) return null;
    int n;
    if (CM_Get_Device_Interface_List_Size(out n, ref USB_HUB, id.ToString(), 0) != 0 || n < 2) return null;
    char[] buf = new char[n];
    if (CM_Get_Device_Interface_List(ref USB_HUB, id.ToString(), buf, n, 0) != 0) return null;
    string s = new string(buf);
    int z = s.IndexOf('\0');
    return z > 0 ? s.Substring(0, z) : null;
  }

  public static List<LkDev> Scan() {
    List<LkDev> list = new List<LkDev>();
    IntPtr set = SetupDiGetClassDevs(ref USB_DEVICE, null, IntPtr.Zero, 0x12);
    try {
      for (int i = 0; ; i++) {
        DEVINFO di = new DEVINFO(); di.cbSize = Marshal.SizeOf(di);
        if (!SetupDiEnumDeviceInfo(set, i, ref di)) break;
        try {
          int t, req; byte[] pb = new byte[4];
          if (!SetupDiGetDeviceRegistryProperty(set, ref di, 0x1C, out t, pb, 4, out req)) continue; // SPDRP_ADDRESS = hub port
          int port = BitConverter.ToInt32(pb, 0);
          string hubPath = HubPath(di.DevInst);
          if (hubPath == null) continue;
          using (SafeFileHandle hub = CreateFile(hubPath, 0x40000000, 2, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (hub.IsInvalid) continue;
            byte[] ci = new byte[512];
            BitConverter.GetBytes(port).CopyTo(ci, 0);
            int r;
            if (!DeviceIoControl(hub, CONN_INFO_EX, ci, ci.Length, ci, ci.Length, out r, IntPtr.Zero)) continue;
            LkDev d = new LkDev();
            d.vendorId = BitConverter.ToUInt16(ci, 12);
            d.productId = BitConverter.ToUInt16(ci, 14);
            d.speed = ci[23] == 0 ? "low" : ci[23] == 1 ? "full" : ci[23] == 2 ? "high" : "super";
            d.product = "";
            d.interfaces = new List<LkIf>();
            int iProduct = ci[19];
            if (iProduct > 0) {
              byte[] s = Descriptor(hub, port, 3, iProduct, 0x0409, 255);
              if (s != null && s.Length > 2) d.product = Encoding.Unicode.GetString(s, 2, Math.Min(s[0], s.Length) - 2).TrimEnd('\0');
            }
            byte[] head = Descriptor(hub, port, 2, 0, 0, 9);
            if (head == null || head.Length < 4) { list.Add(d); continue; }
            byte[] cfg = Descriptor(hub, port, 2, 0, 0, head[2] | (head[3] << 8));
            LkIf cur = null;
            for (int p = 0; cfg != null && p + 1 < cfg.Length && cfg[p] > 0; p += cfg[p]) {
              if (cfg[p + 1] == 4 && p + 8 < cfg.Length) {
                cur = null;
                if (cfg[p + 3] != 0) continue; // alternate settings
                cur = new LkIf(); cur.number = cfg[p + 2]; cur.cls = cfg[p + 5]; cur.subclass = cfg[p + 6]; cur.protocol = cfg[p + 7];
                cur.endpoints = new List<LkEp>();
                d.interfaces.Add(cur);
              } else if (cfg[p + 1] == 5 && cur != null && p + 6 < cfg.Length) {
                LkEp e = new LkEp(); e.address = cfg[p + 2]; e.attributes = cfg[p + 3]; e.bInterval = cfg[p + 6];
                cur.endpoints.Add(e);
              }
            }
            list.Add(d);
          }
        } catch (Exception) { }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return list;
  }
}
'@
ConvertTo-Json -InputObject @([LkUsb]::Scan()) -Depth 6 -Compress
`;

function readWindows() {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 30000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
        if (err) { reject(new Error((stderr || err.message).trim().split('\n')[0])); return; }
        try { resolve(JSON.parse(stdout.trim() || '[]')); } catch (e) { reject(new Error('Unexpected answer from the USB scan')); }
      });
  });
}

/** -> { supported, keyboards: [...], error? } */
async function usbPollingRates() {
  try {
    if (process.platform === 'win32') return { supported: true, keyboards: summarize(await readWindows()) };
    if (process.platform === 'linux') return { supported: true, keyboards: summarize(readLinux()) };
    return { supported: false, keyboards: [] };
  } catch (e) {
    return { supported: true, keyboards: [], error: e.message };
  }
}

module.exports = { usbPollingRates, summarize, periodMs };
