# Local Keymap

An offline desktop app for Windows, macOS and Linux. It covers the parts of VIA most people use, plus support for Geonworks Venom HE boards.

1. **Key tester**: works with any keyboard.
   - *Any keyboard* mode shows a full-size layout and lights up keys from normal key events. It shows press counts (handy for spotting chatter) and lists keys that aren't on the layout.
   - *Switch matrix* mode reads the physical switches straight from the firmware, so Fn and layer keys show up too.
2. **Keymap editor** for keyboards running VIA-compatible firmware (QMK with VIA, and Vial). It covers every layer, layout options (split backspace and so on), rotary encoders, layer-tap and mod-tap, backup and restore. Changes are written to the keyboard right away.
3. **Geonworks Venom HE support** (tested with the Venom 60 HE RGB 7U): keymap editing on all 4 layers, the 4 profiles, split backspace, Venom function keys, the live switch test, and the **polling rate switch (8000 Hz / 1000 Hz)**.

Everything runs on your computer: no internet, no accounts.

## Install

Download the file for your system from the [latest release](../../releases/latest):

| System | File |
|---|---|
| Windows | `LocalKeymap-<version>-win-x64.exe` (installer), or `LocalKeymap-<version>-win-portable.exe` (no install) |
| macOS (Apple silicon / Intel) | `LocalKeymap-<version>-mac-arm64.dmg` / `LocalKeymap-<version>-mac-x64.dmg` |
| Linux | `LocalKeymap-<version>-linux-x86_64.AppImage`, or the `.deb` |

First-run notes:

- **Windows:** the app isn't code-signed, so SmartScreen may warn. Choose *More info* → *Run anyway*.
- **macOS:** the app isn't notarized. Open it once with right-click → *Open* (or *System Settings → Privacy & Security → Open Anyway*).
- **Linux:** by default only root can open keyboard configuration interfaces. Install the udev rule once, then replug the keyboard:

  ```bash
  sudo cp linux/50-local-keymap.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger
  ```

  The rule file is in this repository, and also inside the installed app's `resources/linux` folder.

## Remap a VIA keyboard

1. Open **Keymap**, click **Connect keyboard**, and pick the keyboard. Only keyboards the app can configure are listed. Next time it reconnects by itself.
2. The first time, give the app the keyboard's **VIA definition** (`.json`). Open it, drop it on the window, or put it in the **Definitions folder** (button on the same screen). VIA keyboards don't store their own layout, so this is needed once.
   - Get it from the keyboard maker (usually called the "VIA JSON") or from GitHub `the-via/keyboards`, under `v3/<maker>/<board>/`.
   - No file? *Use a plain matrix grid* still lets you remap by matrix position.
3. Click a key, then click what it should become. You can also:
   - type anything into **Any keycode**, for example `LT(1, KC_SPC)`, `LCTL_T(KC_ESC)`, `LCTL(KC_C)`, `MO(2)` or `0x7C16`;
   - use **Assign by pressing a key** and type on your keyboard. Each key press assigns and moves to the next key.
4. Use **Save backup** before big changes. **Restore** writes only the keys that differ.

Click **Try the demo keyboard** to explore the editor without hardware.

## Geonworks Venom HE boards

Connect the same way. The Venom 60 HE layout is built in. Other Venom boards fall back to an 8×16 grid, or you can load a definition.

- **Profile** switches the keyboard's active profile (1–4) and loads its keymap.
- **Polling rate** sets 8000 Hz (default) or forces 1000 Hz. **Unplug and replug the keyboard to apply it.** The panel shows the speed the keyboard is actually running at. Geonworks fixed this mode in firmware 148, so on older firmware it may not take effect; update through venom.how if so. The firmware has no 2000 or 4000 Hz setting.
- **Venom tab** in the key picker: Win lock, Alt-F4 / Alt-Tab lock, OKS toggle, RGB keys, recalibrate.
- Keys marked **★** are advanced keys (DKS, tap-hold, toggle…) made in venom.how. They're shown but can't be edited here, and assigning a normal key to one replaces it. Backups skip them on restore.
- Calibration, firmware updates, lighting and factory reset stay in venom.how. This app never sends those commands. They're blocked in `app/js/venom.js`.

## Build from source

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Builds the installers for the current system into `dist/`:

```bash
npm run dist
```

Pushing a tag like `v0.2.0` makes GitHub Actions build Windows, macOS and Linux versions and attach them to a release (`.github/workflows/build.yml`).

## Project layout

| Path | What it is |
|---|---|
| `electron/main.js` | Desktop shell: window, keyboard picker, remembered keyboards, definitions folders |
| `electron/preload.js` | The small bridge the page can use (definitions, device picker) |
| `app/` | The interface (plain HTML/CSS/JS, Material Design 3) |
| `app/js/via.js` | VIA raw-HID protocol over WebHID |
| `app/js/venom.js` | Geonworks Venom HE protocol, Venom 60 HE layout, polling rate |
| `app/js/keycodes.js` | Keycode tables for VIA protocols 9–13 (old and new QMK numbering) |
| `app/js/kle.js` | VIA definition layout parser |
| `app/js/mock.js` | The demo keyboard |
| `definitions/` | VIA definition files bundled with the app |
| `linux/50-local-keymap.rules` | udev rule for Linux keyboard access |

## Limits

- Macros can be *assigned* to keys, but their contents are edited in VIA.
- Lighting menus and custom VIA menus aren't included.
- Other keyboards with their own non-VIA software can't be remapped here, because they speak different protocols. The key tester still works with them.
- Vial keyboards work as VIA keyboards, but their built-in layout isn't read. Load the board's `vial.json` (or VIA JSON) as the definition.

## Credits

- Icons: [Material Symbols](https://fonts.google.com/icons) (Apache License 2.0).
- KLE label alignment table: [kle-serial](https://github.com/ijprest/kle-serial) (MIT).
- Protocol references: [VIA](https://github.com/the-via/app) and its [reader](https://github.com/the-via/reader), [QMK](https://github.com/qmk/qmk_firmware). The Venom HE protocol was worked out from the official configurator (venom.how) for interoperability with these keyboards.
- Not affiliated with Geonworks, VIA or QMK.

## License

GPL-3.0. The definition parser and keycode tables follow VIA's GPL-3.0 code. See [LICENSE](LICENSE).
