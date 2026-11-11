# Local Keymap

An offline desktop app for Windows, macOS and Linux. It covers the parts of VIA most people use, plus support for Geonworks Venom HE boards.

1. **Key tester**: works with any keyboard.
   - *Any keyboard* mode shows a full-size layout and lights up keys from normal key events. It shows press counts (handy for spotting chatter) and lists keys that aren't on the layout.
   - *Switch matrix* mode reads the physical switches straight from the firmware, so Fn and layer keys show up too.
2. **Keymap editor** for keyboards running VIA-compatible firmware (QMK with VIA, and Vial). It covers every layer, layout options (split backspace and so on), rotary encoders, layer-tap and mod-tap, backup and restore. Changes are written to the keyboard right away. **No definition file needed**: the layout is found automatically (see below).
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
2. The keyboard's layout appears by itself. The app looks in this order:
   1. a VIA definition you added yourself (the **Definition** button, or the definitions folder), if any;
   2. the layout **stored in the keyboard**: Vial keyboards carry their own;
   3. **VIA's keyboard list**: the definitions of the 2,000+ keyboards VIA supports ship inside the app, matched by USB ID;
   4. otherwise a **matrix grid**: the app reads the matrix size from the keyboard and shows every key position in matrix order, labelled with what it does now. Hold a key on the keyboard and it lights up in the grid. If the size can't be worked out, or looks wrong, type the rows and columns in.
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

Builds the installers for the current system into `dist/` (the first time, this downloads VIA's keyboard list and packs it into `generated/`):

```bash
npm run dist
```

Other commands:

- `npm run defs` refreshes the packed VIA keyboard list from [the-via/keyboards](https://github.com/the-via/keyboards).
- `npm test` checks the .xz decoder, matrix-size detection (against simulated QMK firmware) and Vial layout reading.

Pushing a tag like `v1.2.0` makes GitHub Actions build Windows, macOS and Linux versions and attach them to a release (`.github/workflows/build.yml`).

## Project layout

| Path | What it is |
|---|---|
| `electron/main.js` | Desktop shell: window, keyboard picker, remembered keyboards, definitions folders, VIA keyboard list lookup |
| `electron/preload.js` | The small bridge the page can use (definitions, device picker) |
| `scripts/build-via-definitions.js` | Packs VIA's keyboard definitions into `generated/via-definitions.json.br` (about 190 KB) |
| `app/` | The interface (plain HTML/CSS/JS, Material Design 3) |
| `app/js/via.js` | VIA raw-HID protocol over WebHID, Vial layout and knobs, matrix-size detection |
| `app/js/xz.js` | Small .xz decompressor for the layouts Vial keyboards store |
| `app/js/venom.js` | Geonworks Venom HE protocol, Venom 60 HE layout, polling rate |
| `app/js/keycodes.js` | Keycode tables for VIA protocols 9–13 (old and new QMK numbering) |
| `app/js/kle.js` | VIA definition layout parser |
| `app/js/mock.js` | The demo keyboard |
| `definitions/` | VIA definition files bundled with the app |
| `linux/50-local-keymap.rules` | udev rule for Linux keyboard access |
| `test/` | Tests and their fixtures |

## Limits

- Macros can be *assigned* to keys, but their contents are edited in VIA.
- Lighting menus and custom VIA menus aren't included.
- Other keyboards with their own non-VIA software can't be remapped here, because they speak different protocols. The key tester still works with them.
- Vial-only features (tap dance, combos, key overrides, QMK settings) stay in Vial. Keymaps, layout options and knobs work here.
- The packed VIA keyboard list is a snapshot from the release date. Newer keyboards still work through the matrix grid, or with their definition file.

## Credits

- Icons: [Material Symbols](https://fonts.google.com/icons) (Apache License 2.0).
- KLE label alignment table: [kle-serial](https://github.com/ijprest/kle-serial) (MIT).
- Keyboard layouts: the [VIA keyboards repository](https://github.com/the-via/keyboards) (GPL-3.0), packed into the app at build time. Test fixtures include `vial.json` files from [vial-qmk](https://github.com/vial-kb/vial-qmk) (GPL-2.0-or-later).
- Protocol references: [Vial](https://github.com/vial-kb/vial-gui), [VIA](https://github.com/the-via/app) and its [reader](https://github.com/the-via/reader), [QMK](https://github.com/qmk/qmk_firmware). The Venom HE protocol was worked out from the official configurator (venom.how) for interoperability with these keyboards.
- Not affiliated with Geonworks, VIA or QMK.

## License

GPL-3.0. The definition parser and keycode tables follow VIA's GPL-3.0 code, and the bundled keyboard list comes from VIA's GPL-3.0 keyboards repository. See [LICENSE](LICENSE).
