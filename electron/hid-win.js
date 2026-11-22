/* Local Keymap - feature reports to the Endgame Gear mouse through Windows' own HID calls.
 *
 * Why not WebHID: on Windows each top-level collection of a HID interface is a separate device, and
 * Chromium merges them into one HIDDevice. It takes "this device uses report IDs" from whichever
 * collection it finds first and never updates it when the others are merged in. The 4K dongle's
 * vendor interface has five collections, and when Windows lists one without report IDs first, Chromium
 * refuses every report the mouse needs ("Invalid feature report ID") before anything reaches the
 * dongle. Which one comes first depends on Windows, so the Mouse tab worked on some days and not on
 * others. Endgame Gear's own tool talks to the same collection through hidapi, which uses these calls.
 *
 * One PowerShell process, started on first use, compiles a small C# class and answers one request per
 * line on stdin: "<id> open <vid> <pid> <usagePage> <usage>", "<id> set <handle> <hex>",
 * "<id> get <handle> <reportId>", "<id> close <handle>" -> "<id> ok <result>" or "<id> err <message>".
 * Only the mouse's vendor collection can be opened, and only the commands the mouse driver
 * (app/js/endgame.js) is allowed to send get through. */
'use strict';

const { spawn } = require('child_process');

const VENDOR = 0x3367, PRODUCTS = [0x1970, 0x1982], USAGE_PAGE = 0xff01, USAGE = 0x0002;
const CMD_REPORT = 0xa1, BLOCK_REPORT = 0xa0;
// the same list as SAFE in app/js/endgame.js: link check, versions, battery, read settings, write settings
const SAFE = new Set([0x0f, 0x0d, 0x0e, 0xb4, 0x12, 0x14, 0x15, 0x16]);
const CMD_MAX = 64; // report ID + 63 bytes

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class LkMouseHid {
  [StructLayout(LayoutKind.Sequential)] struct IFD { public int cbSize; public Guid cls; public int flags; public IntPtr reserved; }
  [StructLayout(LayoutKind.Sequential)] struct ATTR { public int Size; public ushort Vid, Pid, Ver; }
  [StructLayout(LayoutKind.Sequential)] struct CAPS {
    public ushort Usage, UsagePage, InLen, OutLen, FeatLen;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort a, b, c, d, e, f, g, h, i, j;
  }
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetAttributes(SafeFileHandle h, ref ATTR a);
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr p);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, ref CAPS c);
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_SetFeature(SafeFileHandle h, byte[] b, int n);
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetFeature(SafeFileHandle h, byte[] b, int n);
  [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr w, int f);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref IFD ifd);
  [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref IFD ifd, IntPtr detail, int size, out int req, IntPtr dev);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sec, uint c, uint f, IntPtr t);

  class Dev { public SafeFileHandle h; public int len; }
  static readonly Dictionary<int, Dev> open = new Dictionary<int, Dev>();
  static int next = 1;

  static List<string> Paths(string idPart) {
    var list = new List<string>();
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12); // DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
    if (set == new IntPtr(-1)) return list;
    try {
      for (int i = 0; ; i++) {
        var ifd = new IFD(); ifd.cbSize = Marshal.SizeOf(typeof(IFD));
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref ifd)) break;
        int req; SetupDiGetDeviceInterfaceDetail(set, ref ifd, IntPtr.Zero, 0, out req, IntPtr.Zero);
        if (req <= 0) continue;
        IntPtr buf = Marshal.AllocHGlobal(req);
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref ifd, buf, req, out req, IntPtr.Zero)) continue;
          string path = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
          if (path != null && path.ToLowerInvariant().Contains(idPart)) list.Add(path);
        } finally { Marshal.FreeHGlobal(buf); }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return list;
  }

  /** The collection with this vendor/product and usage -> "handle featureReportLength". */
  public static string Open(int vid, int pid, int page, int usage) {
    foreach (string path in Paths(string.Format("vid_{0:x4}&pid_{1:x4}", vid, pid))) {
      int len = 0;
      using (SafeFileHandle q = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) { // no access: only asks what it is
        if (q.IsInvalid) continue;
        var a = new ATTR(); a.Size = Marshal.SizeOf(typeof(ATTR));
        if (!HidD_GetAttributes(q, ref a) || a.Vid != vid || a.Pid != pid) continue;
        IntPtr pp;
        if (!HidD_GetPreparsedData(q, out pp)) continue;
        var c = new CAPS(); c.Reserved = new ushort[17];
        try { HidP_GetCaps(pp, ref c); } finally { HidD_FreePreparsedData(pp); }
        if (c.UsagePage != page || c.Usage != usage || c.FeatLen == 0) continue;
        len = c.FeatLen;
      }
      SafeFileHandle h = CreateFile(path, 0xC0000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero); // read/write, shared
      if (h.IsInvalid) throw new Exception("Windows wouldn't open the mouse's settings interface (error " + Marshal.GetLastWin32Error() + ")");
      int id = next++;
      open[id] = new Dev { h = h, len = len };
      return id + " " + len;
    }
    throw new Exception("The mouse's settings interface wasn't found");
  }

  static Dev Get(int id) {
    Dev d;
    if (!open.TryGetValue(id, out d)) throw new Exception("The mouse isn't open");
    return d;
  }

  /** Sends a feature report: report ID first, padded to the collection's feature report length as Windows wants. */
  public static string Set(int id, string hex) {
    Dev d = Get(id);
    byte[] b = new byte[d.len];
    int n = hex.Length / 2;
    if (n == 0 || n > d.len) throw new Exception("Report of the wrong size");
    for (int i = 0; i < n; i++) b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
    if (!HidD_SetFeature(d.h, b, b.Length)) throw new Exception("Windows couldn't send the report (error " + Marshal.GetLastWin32Error() + ")");
    return "";
  }

  /** Reads a feature report -> hex of the whole buffer (report ID first). */
  public static string GetReport(int id, int report) {
    Dev d = Get(id);
    byte[] b = new byte[d.len];
    b[0] = (byte)report;
    if (!HidD_GetFeature(d.h, b, b.Length)) throw new Exception("Windows couldn't read the answer (error " + Marshal.GetLastWin32Error() + ")");
    return BitConverter.ToString(b).Replace("-", "");
  }

  public static string Close(int id) {
    Dev d;
    if (open.TryGetValue(id, out d)) { d.h.Dispose(); open.Remove(id); }
    return "";
  }
}
'@
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[1]) {
      'open' { $r = [LkMouseHid]::Open([int]$p[2], [int]$p[3], [int]$p[4], [int]$p[5]) }
      'set' { $r = [LkMouseHid]::Set([int]$p[2], $p[3]) }
      'get' { $r = [LkMouseHid]::GetReport([int]$p[2], [int]$p[3]) }
      'close' { $r = [LkMouseHid]::Close([int]$p[2]) }
      default { throw 'Unknown request' }
    }
    [Console]::Out.WriteLine($p[0] + ' ok ' + $r)
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    [Console]::Out.WriteLine($p[0] + ' err ' + ($e.Message -replace '[\r\n]+', ' '))
  }
  [Console]::Out.Flush()
}
`;

let proc = null, starting = null, seq = 0, pending = '';
const waiting = new Map();

function stop() {
  if (proc) { try { proc.stdin.end(); proc.kill(); } catch (_) { /* gone */ } }
  proc = null; starting = null; pending = '';
  for (const w of waiting.values()) w.reject(new Error('The mouse helper stopped'));
  waiting.clear();
}

function start() {
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    let stderr = '', ready = false;
    const fail = (err) => { if (!ready) { stop(); reject(err); } };
    const timer = setTimeout(() => fail(new Error('The mouse helper did not start')), 30000);
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc = p;
    p.on('error', (e) => { clearTimeout(timer); fail(e); });
    p.on('exit', () => {
      clearTimeout(timer);
      if (proc !== p) return;
      if (!ready) fail(new Error(stderr.trim().split('\n')[0] || 'The mouse helper stopped'));
      else stop();
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { stderr += d; });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      pending += chunk;
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i).trim();
        pending = pending.slice(i + 1);
        if (!ready && line === 'ready') { ready = true; clearTimeout(timer); resolve(); continue; }
        const m = /^(\d+) (ok|err) ?(.*)$/.exec(line);
        const w = m && waiting.get(m[1]);
        if (!w) continue;
        waiting.delete(m[1]);
        clearTimeout(w.timer);
        if (m[2] === 'ok') w.resolve(m[3]); else w.reject(new Error(m[3] || 'The mouse helper failed'));
      }
    });
  });
  return starting;
}

async function request(...parts) {
  await start();
  const id = String(++seq);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('The mouse helper did not answer')); }, 10000);
    waiting.set(id, { resolve, reject, timer });
    proc.stdin.write(`${id} ${parts.join(' ')}\n`);
  });
}

/** -> { handle, featureLength } for the mouse's vendor collection (dongle or cable). */
async function open(productId) {
  if (process.platform !== 'win32') throw new Error('Only used on Windows');
  if (!PRODUCTS.includes(productId)) throw new Error('Not an Endgame Gear 4K mouse');
  const [handle, len] = (await request('open', VENDOR, productId, USAGE_PAGE, USAGE)).split(' ').map(Number);
  return { handle, featureLength: len };
}

/** bytes: report ID 0xA1 followed by one of the mouse driver's allowed commands. */
async function setFeature(handle, bytes) {
  const b = Uint8Array.from(bytes || []);
  if (b[0] !== CMD_REPORT || !SAFE.has(b[1]) || b.length > CMD_MAX) throw new Error('Refusing to send that to the mouse');
  await request('set', handle | 0, Buffer.from(b).toString('hex'));
}

/** -> Uint8Array of the whole report (report ID first, as the device sent it). */
async function getFeature(handle, reportId) {
  if (reportId !== CMD_REPORT && reportId !== BLOCK_REPORT) throw new Error('Not a mouse report');
  return Uint8Array.from(Buffer.from(await request('get', handle | 0, reportId), 'hex'));
}

async function close(handle) {
  if (!proc) return;
  await request('close', handle | 0);
}

module.exports = { open, setFeature, getFeature, close, stop };
