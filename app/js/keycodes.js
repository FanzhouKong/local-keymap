/* Local Keymap - keycode tables, naming and parsing.
 *
 * Values follow the VIA app's per-protocol tables:
 *   protocol <= 10  -> legacy QMK keycodes (pre 0.19)
 *   protocol 11     -> new QMK keycodes, early VIA layout of macros/custom
 *   protocol >= 12  -> new QMK keycodes (v13 uses the same numbers)
 */
(function () {
  'use strict';

  const hex = (n, w = 4) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');
  // "!\n1" -> "1" (shifted legend dropped), "Prev\nTrack" -> "Prev Track"
  const oneLine = (s) => {
    const parts = String(s).split('\n');
    return parts.length > 1 && parts[0].length === 1 ? parts[parts.length - 1] : parts.join(' ');
  };

  // ---------------------------------------------------------------- basic 0x00-0xFF
  const BASIC = [];
  const b = (code, name, label, ...aliases) => BASIC.push({ code, name, label, aliases });

  b(0x00, 'KC_NO', '', 'XXXXXXX');
  b(0x01, 'KC_TRNS', '▽', '_______', 'KC_TRANSPARENT');
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l, i) => b(0x04 + i, 'KC_' + l, l));
  ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)'].forEach((p, i) => b(0x1e + i, 'KC_' + p[0], p[1] + '\n' + p[0]));
  b(0x28, 'KC_ENT', 'Enter', 'KC_ENTER');
  b(0x29, 'KC_ESC', 'Esc', 'KC_ESCAPE');
  b(0x2a, 'KC_BSPC', 'Bksp', 'KC_BACKSPACE');
  b(0x2b, 'KC_TAB', 'Tab');
  b(0x2c, 'KC_SPC', 'Space', 'KC_SPACE');
  b(0x2d, 'KC_MINS', '_\n-', 'KC_MINUS');
  b(0x2e, 'KC_EQL', '+\n=', 'KC_EQUAL');
  b(0x2f, 'KC_LBRC', '{\n[', 'KC_LEFT_BRACKET');
  b(0x30, 'KC_RBRC', '}\n]', 'KC_RIGHT_BRACKET');
  b(0x31, 'KC_BSLS', '|\n\\', 'KC_BACKSLASH');
  b(0x32, 'KC_NUHS', '~\n#', 'KC_NONUS_HASH');
  b(0x33, 'KC_SCLN', ':\n;', 'KC_SEMICOLON');
  b(0x34, 'KC_QUOT', '"\n\'', 'KC_QUOTE');
  b(0x35, 'KC_GRV', '~\n`', 'KC_GRAVE');
  b(0x36, 'KC_COMM', '<\n,', 'KC_COMMA');
  b(0x37, 'KC_DOT', '>\n.');
  b(0x38, 'KC_SLSH', '?\n/', 'KC_SLASH');
  b(0x39, 'KC_CAPS', 'Caps', 'KC_CAPS_LOCK');
  for (let i = 0; i < 12; i++) b(0x3a + i, 'KC_F' + (i + 1), 'F' + (i + 1));
  b(0x46, 'KC_PSCR', 'PrtSc', 'KC_PRINT_SCREEN');
  b(0x47, 'KC_SCRL', 'ScrLk', 'KC_SLCK', 'KC_SCROLL_LOCK');
  b(0x48, 'KC_PAUS', 'Pause', 'KC_PAUSE', 'KC_BRK');
  b(0x49, 'KC_INS', 'Ins', 'KC_INSERT');
  b(0x4a, 'KC_HOME', 'Home');
  b(0x4b, 'KC_PGUP', 'PgUp', 'KC_PAGE_UP');
  b(0x4c, 'KC_DEL', 'Del', 'KC_DELETE');
  b(0x4d, 'KC_END', 'End');
  b(0x4e, 'KC_PGDN', 'PgDn', 'KC_PAGE_DOWN');
  b(0x4f, 'KC_RGHT', '→', 'KC_RIGHT');
  b(0x50, 'KC_LEFT', '←');
  b(0x51, 'KC_DOWN', '↓');
  b(0x52, 'KC_UP', '↑');
  b(0x53, 'KC_NUM', 'Num\nLock', 'KC_NLCK', 'KC_NUM_LOCK');
  b(0x54, 'KC_PSLS', 'Num\n/', 'KC_KP_SLASH');
  b(0x55, 'KC_PAST', 'Num\n*', 'KC_KP_ASTERISK');
  b(0x56, 'KC_PMNS', 'Num\n-', 'KC_KP_MINUS');
  b(0x57, 'KC_PPLS', 'Num\n+', 'KC_KP_PLUS');
  b(0x58, 'KC_PENT', 'Num\nEnter', 'KC_KP_ENTER');
  for (let i = 1; i <= 9; i++) b(0x58 + i, 'KC_P' + i, 'Num\n' + i, 'KC_KP_' + i);
  b(0x62, 'KC_P0', 'Num\n0', 'KC_KP_0');
  b(0x63, 'KC_PDOT', 'Num\n.', 'KC_KP_DOT');
  b(0x64, 'KC_NUBS', 'ISO\n\\', 'KC_NONUS_BACKSLASH');
  b(0x65, 'KC_APP', 'Menu', 'KC_APPLICATION');
  b(0x66, 'KC_KB_POWER', 'Power\n(kb)', 'KC_POWER');
  b(0x67, 'KC_PEQL', 'Num\n=', 'KC_KP_EQUAL');
  for (let i = 0; i < 12; i++) b(0x68 + i, 'KC_F' + (i + 13), 'F' + (i + 13));
  [['KC_EXEC', 'Exec'], ['KC_HELP', 'Help'], ['KC_MENU', 'Menu\n(kb)'], ['KC_SLCT', 'Select'], ['KC_STOP', 'Stop'],
    ['KC_AGIN', 'Again'], ['KC_UNDO', 'Undo'], ['KC_CUT', 'Cut'], ['KC_COPY', 'Copy'], ['KC_PSTE', 'Paste'],
    ['KC_FIND', 'Find'], ['KC_KB_MUTE', 'Mute\n(kb)'], ['KC_KB_VOLUME_UP', 'Vol+\n(kb)'], ['KC_KB_VOLUME_DOWN', 'Vol-\n(kb)'],
    ['KC_LCAP', 'Lock\nCaps'], ['KC_LNUM', 'Lock\nNum'], ['KC_LSCR', 'Lock\nScrl'], ['KC_PCMM', 'Num\n,', 'KC_KP_COMMA']]
    .forEach(([n, l, ...a], i) => b(0x74 + i, n, l, ...a));
  for (let i = 1; i <= 9; i++) b(0x86 + i, 'KC_INT' + i, 'Int ' + i, 'KC_INTERNATIONAL_' + i);
  for (let i = 1; i <= 9; i++) b(0x8f + i, 'KC_LNG' + i, 'Lang ' + i, 'KC_LANGUAGE_' + i);
  [['KC_ERAS', 'Alt\nErase'], ['KC_SYRQ', 'SysRq'], ['KC_CNCL', 'Cancel'], ['KC_CLR', 'Clear'], ['KC_PRIR', 'Prior'],
    ['KC_RETN', 'Return'], ['KC_SEPR', 'Sep'], ['KC_OUT', 'Out'], ['KC_OPER', 'Oper'], ['KC_CLAG', 'Clear\nAgain'],
    ['KC_CRSL', 'CrSel'], ['KC_EXSL', 'ExSel']].forEach(([n, l], i) => b(0x99 + i, n, l));

  // 0xA5.. system / consumer (same numbers in every protocol)
  const MEDIA = [
    ['KC_PWR', 'Power', 'KC_SYSTEM_POWER'], ['KC_SLEP', 'Sleep', 'KC_SYSTEM_SLEEP'], ['KC_WAKE', 'Wake', 'KC_SYSTEM_WAKE'],
    ['KC_MUTE', 'Mute', 'KC_AUDIO_MUTE'], ['KC_VOLU', 'Vol +', 'KC_AUDIO_VOL_UP'], ['KC_VOLD', 'Vol -', 'KC_AUDIO_VOL_DOWN'],
    ['KC_MNXT', 'Next\nTrack', 'KC_MEDIA_NEXT_TRACK'], ['KC_MPRV', 'Prev\nTrack', 'KC_MEDIA_PREV_TRACK'],
    ['KC_MSTP', 'Media\nStop', 'KC_MEDIA_STOP'], ['KC_MPLY', 'Play\nPause', 'KC_MEDIA_PLAY_PAUSE'],
    ['KC_MSEL', 'Media\nSelect', 'KC_MEDIA_SELECT'], ['KC_EJCT', 'Eject', 'KC_MEDIA_EJECT'], ['KC_MAIL', 'Mail'],
    ['KC_CALC', 'Calc', 'KC_CALCULATOR'], ['KC_MYCM', 'My\nPC', 'KC_MY_COMPUTER'], ['KC_WSCH', 'Web\nSearch', 'KC_WWW_SEARCH'],
    ['KC_WHOM', 'Web\nHome', 'KC_WWW_HOME'], ['KC_WBAK', 'Web\nBack', 'KC_WWW_BACK'], ['KC_WFWD', 'Web\nFwd', 'KC_WWW_FORWARD'],
    ['KC_WSTP', 'Web\nStop', 'KC_WWW_STOP'], ['KC_WREF', 'Web\nRefresh', 'KC_WWW_REFRESH'], ['KC_WFAV', 'Web\nFav', 'KC_WWW_FAVORITES'],
    ['KC_MFFD', 'Fast\nFwd', 'KC_MEDIA_FAST_FORWARD'], ['KC_MRWD', 'Rewind', 'KC_MEDIA_REWIND'],
    ['KC_BRIU', 'Bright\n+', 'KC_BRIGHTNESS_UP'], ['KC_BRID', 'Bright\n-', 'KC_BRIGHTNESS_DOWN'],
    ['KC_CPNL', 'Control\nPanel', 'KC_CONTROL_PANEL'], ['KC_ASST', 'Assist', 'KC_ASSISTANT'],
    ['KC_MCTL', 'Mission\nCtrl', 'KC_MISSION_CONTROL'], ['KC_LPAD', 'Launch\npad', 'KC_LAUNCHPAD'],
  ];
  // modern: 0xCD..0xDF in this order; legacy: 0xF0..0xFF without BTN6-8
  const MOUSE = [
    ['KC_MS_U', 'Mouse\n↑', 'KC_MS_UP', 'MS_UP'], ['KC_MS_D', 'Mouse\n↓', 'KC_MS_DOWN', 'MS_DOWN'],
    ['KC_MS_L', 'Mouse\n←', 'KC_MS_LEFT', 'MS_LEFT'], ['KC_MS_R', 'Mouse\n→', 'KC_MS_RIGHT', 'MS_RGHT'],
    ['KC_BTN1', 'Mouse\nBtn 1', 'KC_MS_BTN1', 'MS_BTN1'], ['KC_BTN2', 'Mouse\nBtn 2', 'KC_MS_BTN2', 'MS_BTN2'],
    ['KC_BTN3', 'Mouse\nBtn 3', 'KC_MS_BTN3', 'MS_BTN3'], ['KC_BTN4', 'Mouse\nBtn 4', 'KC_MS_BTN4', 'MS_BTN4'],
    ['KC_BTN5', 'Mouse\nBtn 5', 'KC_MS_BTN5', 'MS_BTN5'], ['KC_BTN6', 'Mouse\nBtn 6', 'KC_MS_BTN6', 'MS_BTN6'],
    ['KC_BTN7', 'Mouse\nBtn 7', 'KC_MS_BTN7', 'MS_BTN7'], ['KC_BTN8', 'Mouse\nBtn 8', 'KC_MS_BTN8', 'MS_BTN8'],
    ['KC_WH_U', 'Wheel\n↑', 'KC_MS_WH_UP', 'MS_WHLU'], ['KC_WH_D', 'Wheel\n↓', 'KC_MS_WH_DOWN', 'MS_WHLD'],
    ['KC_WH_L', 'Wheel\n←', 'KC_MS_WH_LEFT', 'MS_WHLL'], ['KC_WH_R', 'Wheel\n→', 'KC_MS_WH_RIGHT', 'MS_WHLR'],
    ['KC_ACL0', 'Accel\n0', 'KC_MS_ACCEL0', 'MS_ACL0'], ['KC_ACL1', 'Accel\n1', 'KC_MS_ACCEL1', 'MS_ACL1'],
    ['KC_ACL2', 'Accel\n2', 'KC_MS_ACCEL2', 'MS_ACL2'],
  ];
  const MODS = [
    ['KC_LCTL', 'LCtrl', 'KC_LEFT_CTRL'], ['KC_LSFT', 'LShift', 'KC_LEFT_SHIFT'],
    ['KC_LALT', 'LAlt', 'KC_LOPT', 'KC_LEFT_ALT'], ['KC_LGUI', 'LWin', 'KC_LCMD', 'KC_LWIN', 'KC_LEFT_GUI'],
    ['KC_RCTL', 'RCtrl', 'KC_RIGHT_CTRL'], ['KC_RSFT', 'RShift', 'KC_RIGHT_SHIFT'],
    ['KC_RALT', 'RAlt', 'KC_ALGR', 'KC_ROPT', 'KC_RIGHT_ALT'], ['KC_RGUI', 'RWin', 'KC_RCMD', 'KC_RWIN', 'KC_RIGHT_GUI'],
  ];

  // ---------------------------------------------------------------- quantum
  // [name, label, legacy (<=10), protocol 11, protocol 12+, ...aliases]   (null = not available)
  const QUANTUM = [
    ['QK_BOOT', 'Boot-\nloader', 0x5c00, 0x7c00, 0x7c00, 'RESET', 'QK_BOOTLOADER'],
    ['QK_RBT', 'Reboot', null, 0x7c01, 0x7c01, 'QK_REBOOT'],
    ['DB_TOGG', 'Debug', 0x5c01, 0x7c02, 0x7c02, 'DEBUG', 'QK_DEBUG_TOGGLE'],
    ['EE_CLR', 'Clear\nEEPROM', null, 0x7c03, 0x7c03, 'QK_CLEAR_EEPROM', 'EEP_RST'],
    ['QK_GESC', 'Esc\n~', 0x5c16, 0x7c16, 0x7c16, 'KC_GESC', 'QK_GRAVE_ESCAPE'],
    ['NK_TOGG', 'NKRO\nToggle', 0x5c14, 0x7013, 0x7013, 'MAGIC_TOGGLE_NKRO'],
    ['CW_TOGG', 'Caps\nWord', null, 0x7c73, 0x7c73, 'QK_CAPS_WORD_TOGGLE'],
    ['SC_LSPO', 'LShift\n(', 0x5cd7, 0x7c1a, 0x7c1a, 'KC_LSPO'],
    ['SC_RSPC', 'RShift\n)', 0x5cd8, 0x7c1b, 0x7c1b, 'KC_RSPC'],
    ['SC_LCPO', 'LCtrl\n(', 0x5cf3, 0x7c18, 0x7c18, 'KC_LCPO'],
    ['SC_RCPC', 'RCtrl\n)', 0x5cf4, 0x7c19, 0x7c19, 'KC_RCPC'],
    ['SC_LAPO', 'LAlt\n(', 0x5cf5, 0x7c1c, 0x7c1c, 'KC_LAPO'],
    ['SC_RAPC', 'RAlt\n)', 0x5cf6, 0x7c1d, 0x7c1d, 'KC_RAPC'],
    ['SC_SENT', 'RShift\nEnter', 0x5cd9, 0x7c1e, 0x7c1e, 'KC_SFTENT'],
    ['FN_MO13', 'Fn1\n(Fn3)', 0x5f10, 0x7700, 0x7c77, 'TL_LOWR', 'QK_TRI_LAYER_LOWER'],
    ['FN_MO23', 'Fn2\n(Fn3)', 0x5f11, 0x7701, 0x7c78, 'TL_UPPR', 'QK_TRI_LAYER_UPPER'],
    ['AG_SWAP', 'Swap\nAlt/Win', null, 0x7014, 0x7014, 'MAGIC_SWAP_ALT_GUI'],
    ['AG_NORM', 'Unswap\nAlt/Win', null, 0x7015, 0x7015, 'MAGIC_UNSWAP_ALT_GUI'],
    ['AG_TOGG', 'Toggle\nAlt/Win', null, 0x7016, 0x7016, 'MAGIC_TOGGLE_ALT_GUI'],
    ['CG_SWAP', 'Swap\nCtl/Win', null, 0x701b, 0x701b, 'MAGIC_SWAP_CTL_GUI'],
    ['CG_NORM', 'Unswap\nCtl/Win', null, 0x701c, 0x701c, 'MAGIC_UNSWAP_CTL_GUI'],
    ['CG_TOGG', 'Toggle\nCtl/Win', null, 0x701d, 0x701d, 'MAGIC_TOGGLE_CTL_GUI'],
    ['AS_TOGG', 'Auto\nShift', null, 0x7c15, 0x7c15, 'KC_ASTG'],
    ['AS_ON', 'AShift\nOn', null, 0x7c13, 0x7c13, 'KC_ASON'],
    ['AS_OFF', 'AShift\nOff', null, 0x7c14, 0x7c14, 'KC_ASOFF'],
    ['AS_UP', 'AShift\n+', null, 0x7c11, 0x7c11, 'KC_ASUP'],
    ['AS_DOWN', 'AShift\n-', null, 0x7c10, 0x7c10, 'KC_ASDN'],
    ['AS_RPT', 'AShift\nReport', null, 0x7c12, 0x7c12, 'KC_ASRP'],
    ['DM_REC1', 'Rec\nMacro 1', null, 0x7c53, 0x7c53, 'DYN_REC_START1'],
    ['DM_REC2', 'Rec\nMacro 2', null, 0x7c54, 0x7c54, 'DYN_REC_START2'],
    ['DM_RSTP', 'Stop\nRec', null, 0x7c55, 0x7c55, 'DYN_REC_STOP'],
    ['DM_PLY1', 'Play\nMacro 1', null, 0x7c56, 0x7c56, 'DYN_MACRO_PLAY1'],
    ['DM_PLY2', 'Play\nMacro 2', null, 0x7c57, 0x7c57, 'DYN_MACRO_PLAY2'],
    ['CM_TOGG', 'Combo\nToggle', null, 0x7c52, 0x7c52, 'CMB_TOG'],
  ];
  // [name, label, legacy (<=10), 11+, ...aliases]
  const LIGHTING = [
    ['BL_TOGG', 'BL\nToggle', 0x5cbf, 0x7802], ['BL_ON', 'BL\nOn', 0x5cbb, 0x7800], ['BL_OFF', 'BL\nOff', 0x5cbc, 0x7801],
    ['BL_UP', 'BL\n+', 0x5cbe, 0x7804, 'BL_INC'], ['BL_DOWN', 'BL\n-', 0x5cbd, 0x7803, 'BL_DEC'],
    ['BL_STEP', 'BL\nCycle', 0x5cc0, 0x7805], ['BL_BRTG', 'BL\nBreathe', 0x5cc1, 0x7806],
    ['RGB_TOG', 'RGB\nToggle', 0x5cc2, 0x7820, 'UG_TOGG'], ['RGB_MOD', 'RGB\nMode +', 0x5cc3, 0x7821, 'UG_NEXT'],
    ['RGB_RMOD', 'RGB\nMode -', 0x5cc4, 0x7822, 'UG_PREV'], ['RGB_HUI', 'Hue\n+', 0x5cc5, 0x7823, 'UG_HUEU'],
    ['RGB_HUD', 'Hue\n-', 0x5cc6, 0x7824, 'UG_HUED'], ['RGB_SAI', 'Sat\n+', 0x5cc7, 0x7825, 'UG_SATU'],
    ['RGB_SAD', 'Sat\n-', 0x5cc8, 0x7826, 'UG_SATD'], ['RGB_VAI', 'Bright\n+', 0x5cc9, 0x7827, 'UG_VALU'],
    ['RGB_VAD', 'Bright\n-', 0x5cca, 0x7828, 'UG_VALD'], ['RGB_SPI', 'Speed\n+', 0x5ccb, 0x7829, 'UG_SPDU'],
    ['RGB_SPD', 'Speed\n-', 0x5ccc, 0x782a, 'UG_SPDD'], ['RGB_M_P', 'RGB\nPlain', 0x5ccd, 0x782b],
    ['RGB_M_B', 'RGB\nBreathe', 0x5cce, 0x782c], ['RGB_M_R', 'RGB\nRainbow', 0x5ccf, 0x782d],
    ['RGB_M_SW', 'RGB\nSwirl', 0x5cd0, 0x782e], ['RGB_M_SN', 'RGB\nSnake', 0x5cd1, 0x782f],
    ['RGB_M_K', 'RGB\nKnight', 0x5cd2, 0x7830], ['RGB_M_X', 'RGB\nXmas', 0x5cd3, 0x7831], ['RGB_M_G', 'RGB\nGradient', 0x5cd4, 0x7832],
  ];
  // protocol 12+ only
  const RGB_MATRIX = [
    ['RM_TOGG', 'Matrix\nToggle', 0x7842], ['RM_ON', 'Matrix\nOn', 0x7840], ['RM_OFF', 'Matrix\nOff', 0x7841],
    ['RM_NEXT', 'Matrix\nMode +', 0x7843], ['RM_PREV', 'Matrix\nMode -', 0x7844], ['RM_HUEU', 'M Hue\n+', 0x7845],
    ['RM_HUED', 'M Hue\n-', 0x7846], ['RM_SATU', 'M Sat\n+', 0x7847], ['RM_SATD', 'M Sat\n-', 0x7848],
    ['RM_VALU', 'M Bri\n+', 0x7849], ['RM_VALD', 'M Bri\n-', 0x784a], ['RM_SPDU', 'M Spd\n+', 0x784b], ['RM_SPDD', 'M Spd\n-', 0x784c],
  ];

  const MODERN = {
    MT: 0x2000, MT_MAX: 0x3fff, LT: 0x4000, LT_MAX: 0x4fff, LM: 0x5000, LM_MAX: 0x51ff, LM_SHIFT: 5, LM_MASK: 0x1f,
    TO: 0x5200, TO_MAX: 0x521f, MO: 0x5220, MO_MAX: 0x523f, DF: 0x5240, DF_MAX: 0x525f, TG: 0x5260, TG_MAX: 0x527f,
    OSL: 0x5280, OSL_MAX: 0x529f, OSM: 0x52a0, OSM_MAX: 0x52bf, TT: 0x52c0, TT_MAX: 0x52df,
  };
  const LEGACY = {
    MT: 0x6000, MT_MAX: 0x7fff, LT: 0x4000, LT_MAX: 0x4fff, LM: 0x5900, LM_MAX: 0x59ff, LM_SHIFT: 4, LM_MASK: 0x0f,
    TO: 0x5000, TO_MAX: 0x501f, MO: 0x5100, MO_MAX: 0x511f, DF: 0x5200, DF_MAX: 0x521f, TG: 0x5300, TG_MAX: 0x531f,
    OSL: 0x5400, OSL_MAX: 0x541f, OSM: 0x5500, OSM_MAX: 0x55ff, TT: 0x5800, TT_MAX: 0x581f,
  };
  const EXTRA = {
    12: { MACRO: 0x7700, MACRO_MAX: 0x777f, KB: 0x7e00, KB_MAX: 0x7eff },
    11: { MACRO: 0x7702, MACRO_MAX: 0x7711, KB: 0x7f00, KB_MAX: 0x7fff },
    10: { MACRO: 0x5f12, MACRO_MAX: 0x5f21, KB: 0x5f80, KB_MAX: 0x5f8f },
  };
  const LAYER_FNS = ['MO', 'TG', 'TO', 'TT', 'OSL', 'DF'];

  // modifier sets: bit0 Ctrl, bit1 Shift, bit2 Alt, bit3 GUI, bit4 = right-hand
  const MODSETS = {
    LCTL: 0x01, CTL: 0x01, C: 0x01, LSFT: 0x02, SFT: 0x02, S: 0x02, LALT: 0x04, ALT: 0x04, A: 0x04, LOPT: 0x04, OPT: 0x04,
    LGUI: 0x08, GUI: 0x08, G: 0x08, LCMD: 0x08, CMD: 0x08, LWIN: 0x08, WIN: 0x08,
    RCTL: 0x11, RSFT: 0x12, RALT: 0x14, ALGR: 0x14, ROPT: 0x14, RGUI: 0x18, RCMD: 0x18, RWIN: 0x18,
    MEH: 0x07, HYPR: 0x0f, ALL: 0x0f, C_S: 0x03, LCS: 0x03, LCA: 0x05, LCG: 0x09, LSA: 0x06, LSG: 0x0a, SGUI: 0x0a,
    SCMD: 0x0a, SWIN: 0x0a, LAG: 0x0c, LCSG: 0x0b, LCAG: 0x0d, LSAG: 0x0e,
    RCS: 0x13, RCA: 0x15, RCG: 0x19, RSA: 0x16, RSG: 0x1a, RAG: 0x1c, RCSG: 0x1b, RCAG: 0x1d, RSAG: 0x1e,
  };
  const TAP_NAMES = { 0x01: 'LCTL_T', 0x02: 'LSFT_T', 0x04: 'LALT_T', 0x08: 'LGUI_T', 0x11: 'RCTL_T', 0x12: 'RSFT_T', 0x14: 'RALT_T', 0x18: 'RGUI_T', 0x07: 'MEH_T', 0x0f: 'HYPR_T', 0x03: 'C_S_T', 0x0a: 'LSG_T' };

  function modsName(m) {
    const r = m & 0x10 ? 'R' : 'L';
    const p = [];
    if (m & 1) p.push(`MOD_${r}CTL`);
    if (m & 2) p.push(`MOD_${r}SFT`);
    if (m & 4) p.push(`MOD_${r}ALT`);
    if (m & 8) p.push(`MOD_${r}GUI`);
    return p.join('|') || '0';
  }
  function modsLabel(m) {
    const r = m & 0x10 ? 'R' : '';
    if ((m & 0x0f) === 0x0f) return r + 'Hyper';
    if ((m & 0x0f) === 0x07) return r + 'Meh';
    const p = [];
    if (m & 1) p.push('Ctl');
    if (m & 2) p.push('Sft');
    if (m & 4) p.push('Alt');
    if (m & 8) p.push('Win');
    return r + p.join('+');
  }
  function wrapName(m, inner) {
    if (m === 0x0f) return `HYPR(${inner})`;
    if (m === 0x07) return `MEH(${inner})`;
    const r = m & 0x10 ? 'R' : 'L';
    let s = inner;
    if (m & 8) s = `${r}GUI(${s})`;
    if (m & 4) s = `${r}ALT(${s})`;
    if (m & 2) s = `${r}SFT(${s})`;
    if (m & 1) s = `${r}CTL(${s})`;
    return s;
  }
  function parseMods(text) {
    const t = text.trim().toUpperCase();
    if (/^0X[0-9A-F]+$/.test(t)) return parseInt(t, 16) & 0x1f;
    return t.split('|').reduce((acc, part) => {
      const p = part.trim().replace(/^MOD_/, '');
      if (!(p in MODSETS)) throw new Error(`Unknown modifier "${part.trim()}"`);
      return acc | MODSETS[p];
    }, 0);
  }
  function splitArgs(s) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim() || out.length) out.push(cur.trim());
    return out;
  }

  class Keycodes {
    constructor(protocol = 12, customKeycodes = [], opts = {}) {
      this.protocol = protocol;
      // Vial firmware reports VIA protocol 9 but may use the new keycodes (vial protocol >= 6).
      const modernVial = opts.vialProtocol >= 6;
      this.ver = modernVial || protocol >= 12 ? 12 : protocol === 11 ? 11 : protocol === 10 ? 10 : 9;
      const legacy = this.ver <= 10;
      this.legacy = legacy;
      this.R = Object.assign({}, legacy ? LEGACY : MODERN, EXTRA[legacy ? 10 : this.ver]);
      this.toBase = this.ver === 9 ? 0x5010 : this.R.TO; // old QMK: TO() carried an ON_PRESS bit
      this.byCode = new Map();
      this.byName = new Map();

      BASIC.forEach((k) => this._add(k.code, k.name, k.label, k.aliases));
      MEDIA.forEach(([n, l, ...a], i) => this._add(0xa5 + i, n, l, a));
      MODS.forEach(([n, l, ...a], i) => this._add(0xe0 + i, n, l, a));
      let mouse = legacy ? 0xf0 : 0xcd;
      MOUSE.forEach(([n, l, ...a]) => {
        if (legacy && /BTN[678]$/.test(n)) return;
        this._add(mouse++, n, l, a);
      });
      const col = legacy ? 2 : this.ver === 11 ? 3 : 4;
      QUANTUM.forEach((q) => { if (q[col] != null) this._add(q[col], q[0], q[1], q.slice(5)); });
      LIGHTING.forEach((q) => this._add(legacy ? q[2] : q[3], q[0], q[1], q.slice(4)));
      if (this.ver >= 12) RGB_MATRIX.forEach(([n, l, v]) => this._add(v, n, l, []));

      this.custom = Array.isArray(customKeycodes) ? customKeycodes : [];
      this.custom.forEach((ck, i) => {
        const code = this.R.KB + i;
        if (code > this.R.KB_MAX) return;
        const label = (ck && (ck.shortName || ck.name || ck.title)) || `Custom\n${i}`;
        this.byCode.set(code, { name: `CUSTOM(${i})`, label, title: ck && (ck.title || ck.name) });
        if (ck && ck.name) this.byName.set(String(ck.name).toUpperCase(), code);
      });
    }

    _add(code, name, label, aliases) {
      if (!this.byCode.has(code)) this.byCode.set(code, { name, label });
      [name, ...(aliases || [])].forEach((n) => {
        const k = n.toUpperCase();
        if (!this.byName.has(k)) this.byName.set(k, code);
      });
    }

    _basic(code) {
      const e = this.byCode.get(code & 0xff);
      return e || { name: hex(code & 0xff, 2), label: hex(code & 0xff, 2) };
    }

    /** -> { name, label, title? } for any 16-bit keycode */
    describe(code) {
      const R = this.R;
      const hit = this.byCode.get(code);
      if (hit) return hit;
      if (code <= 0xff) return { name: hex(code), label: hex(code) };
      const inR = (lo, hi) => code >= lo && code <= hi;
      if (code <= 0x1fff) {
        const m = (code >> 8) & 0x1f, k = this._basic(code);
        return { name: wrapName(m, k.name), label: `${modsLabel(m)}+\n${oneLine(k.label)}` };
      }
      if (inR(R.MT, R.MT_MAX)) {
        const m = (code >> 8) & 0x1f, k = this._basic(code);
        const name = TAP_NAMES[m] ? `${TAP_NAMES[m]}(${k.name})` : `MT(${modsName(m)}, ${k.name})`;
        return { name, label: `${modsLabel(m)} hold\n${oneLine(k.label)}` };
      }
      if (inR(R.LT, R.LT_MAX)) {
        const l = (code >> 8) & 0x0f, k = this._basic(code);
        return { name: `LT(${l}, ${k.name})`, label: `LT ${l}\n${oneLine(k.label)}` };
      }
      if (inR(R.LM, R.LM_MAX)) {
        const l = (code >> R.LM_SHIFT) & 0x0f, m = code & R.LM_MASK;
        return { name: `LM(${l}, ${modsName(m)})`, label: `LM ${l}\n${modsLabel(m)}` };
      }
      if (inR(R.OSM, R.OSM_MAX)) {
        const m = code & 0x1f;
        return { name: `OSM(${modsName(m)})`, label: `OSM\n${modsLabel(m)}` };
      }
      for (const fn of LAYER_FNS) {
        if (inR(R[fn], R[fn + '_MAX'])) {
          const l = fn === 'TO' && this.ver === 9 ? code & 0x0f : code - R[fn];
          return { name: `${fn}(${l})`, label: `${fn}(${l})` };
        }
      }
      if (inR(R.MACRO, R.MACRO_MAX)) {
        const n = code - R.MACRO;
        return { name: `MACRO(${n})`, label: `M${n}` };
      }
      if (inR(R.KB, R.KB_MAX)) {
        const n = code - R.KB;
        return { name: `CUSTOM(${n})`, label: `Custom\n${n}` };
      }
      return { name: hex(code), label: hex(code) };
    }

    name(code) { return this.describe(code).name; }
    label(code) { return this.describe(code).label; }

    /** Parse "KC_A", "a", "0x1234", "MO(1)", "LT(1, KC_SPC)", "LCTL(KC_C)", "MT(MOD_LCTL|MOD_LSFT, KC_A)" ... */
    parse(text) {
      const s = String(text).trim();
      if (!s) throw new Error('Type a keycode');
      if (/^0x[0-9a-f]{1,4}$/i.test(s)) return parseInt(s, 16);
      const up = s.toUpperCase();
      if (this.byName.has(up)) return this.byName.get(up);
      if (this.byName.has('KC_' + up)) return this.byName.get('KC_' + up);
      let m = /^M(?:ACRO)?(\d+)$/.exec(up);
      if (m) return this._macro(+m[1]);
      m = /^([A-Z_][A-Z0-9_]*)\s*\(([\s\S]*)\)$/.exec(up);
      if (!m) throw new Error(`Unknown keycode "${s}"`);
      const fn = m[1], args = splitArgs(m[2]), R = this.R;
      const need = (n) => { if (args.length !== n) throw new Error(`${fn}() takes ${n} argument${n > 1 ? 's' : ''}`); };
      const int = (v) => {
        const n = /^0X/.test(v) ? parseInt(v, 16) : /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
        if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}"`);
        return n;
      };
      const basic = (v) => {
        const c = this.parse(v);
        if (c > 0xff) throw new Error(`${fn}() only takes a basic keycode (got ${v})`);
        return c;
      };
      const layer16 = (v) => {
        const l = int(v);
        if (l < 0 || l > 15) throw new Error('Layer must be 0-15');
        return l;
      };
      if (LAYER_FNS.includes(fn)) {
        need(1);
        const l = int(args[0]);
        const base = fn === 'TO' ? this.toBase : R[fn];
        if (l < 0 || base + l > R[fn + '_MAX']) throw new Error(`Layer ${l} is out of range for ${fn}()`);
        return base + l;
      }
      if (fn === 'OSM') { need(1); return R.OSM | parseMods(args[0]); }
      if (fn === 'LT') { need(2); return R.LT | (layer16(args[0]) << 8) | basic(args[1]); }
      if (fn === 'MT') { need(2); return R.MT | (parseMods(args[0]) << 8) | basic(args[1]); }
      if (fn === 'LM') { need(2); return R.LM | (layer16(args[0]) << R.LM_SHIFT) | (parseMods(args[1]) & R.LM_MASK); }
      if (fn === 'MACRO' || fn === 'M') { need(1); return this._macro(int(args[0])); }
      if (fn === 'CUSTOM' || fn === 'USER' || fn === 'QK_KB') {
        need(1);
        const n = int(args[0]);
        if (R.KB + n > R.KB_MAX) throw new Error('Custom keycode index out of range');
        return R.KB + n;
      }
      if (fn.endsWith('_T') && MODSETS[fn.slice(0, -2)] !== undefined) {
        need(1);
        return R.MT | (MODSETS[fn.slice(0, -2)] << 8) | basic(args[0]);
      }
      if (MODSETS[fn] !== undefined) {
        need(1);
        const inner = this.parse(args[0]);
        if (inner > 0x1fff) throw new Error(`${fn}() only wraps basic keycodes`);
        return inner | (MODSETS[fn] << 8);
      }
      throw new Error(`Unknown function ${fn}()`);
    }

    _macro(n) {
      if (n < 0 || this.R.MACRO + n > this.R.MACRO_MAX) throw new Error(`Macro ${n} is out of range`);
      return this.R.MACRO + n;
    }

    /** Picker categories: [{ id, title, groups: [{ title, codes }] , hint? }] */
    categories(layerCount = 4, macroCount = 16) {
      const pick = (names) => names.map((n) => this.byName.get(n.toUpperCase())).filter((c) => c !== undefined);
      const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => prefix + (from + i));
      const layers = Array.from({ length: Math.max(1, layerCount) }, (_, i) => i);
      const cats = [
        {
          id: 'basic', title: 'Basic', groups: [
            { title: 'Special', codes: pick(['KC_NO', 'KC_TRNS']) },
            { title: 'Letters', codes: pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => 'KC_' + l)) },
            { title: 'Numbers', codes: pick(range('KC_', 1, 9).concat('KC_0')) },
            { title: 'Editing', codes: pick(['KC_ESC', 'KC_TAB', 'KC_CAPS', 'KC_ENT', 'KC_BSPC', 'KC_SPC', 'KC_DEL', 'KC_INS', 'KC_APP']) },
            { title: 'Symbols', codes: pick(['KC_GRV', 'KC_MINS', 'KC_EQL', 'KC_LBRC', 'KC_RBRC', 'KC_BSLS', 'KC_SCLN', 'KC_QUOT', 'KC_COMM', 'KC_DOT', 'KC_SLSH', 'KC_NUHS', 'KC_NUBS']) },
            { title: 'Modifiers', codes: pick(['KC_LCTL', 'KC_LSFT', 'KC_LALT', 'KC_LGUI', 'KC_RCTL', 'KC_RSFT', 'KC_RALT', 'KC_RGUI']) },
            { title: 'Navigation', codes: pick(['KC_UP', 'KC_DOWN', 'KC_LEFT', 'KC_RGHT', 'KC_HOME', 'KC_END', 'KC_PGUP', 'KC_PGDN', 'KC_PSCR', 'KC_SCRL', 'KC_PAUS']) },
            { title: 'Function', codes: pick(range('KC_F', 1, 24)) },
            { title: 'Numpad', codes: pick(['KC_NUM', 'KC_PSLS', 'KC_PAST', 'KC_PMNS', 'KC_PPLS', 'KC_PENT'].concat(range('KC_P', 1, 9), ['KC_P0', 'KC_PDOT', 'KC_PEQL', 'KC_PCMM'])) },
            { title: 'International', codes: pick(range('KC_INT', 1, 5).concat(range('KC_LNG', 1, 5))) },
          ],
        },
        {
          id: 'media', title: 'Media', groups: [
            { title: 'Audio & media', codes: pick(['KC_MUTE', 'KC_VOLD', 'KC_VOLU', 'KC_MPLY', 'KC_MSTP', 'KC_MPRV', 'KC_MNXT', 'KC_MRWD', 'KC_MFFD', 'KC_MSEL', 'KC_EJCT']) },
            { title: 'System', codes: pick(['KC_BRID', 'KC_BRIU', 'KC_PWR', 'KC_SLEP', 'KC_WAKE', 'KC_CALC', 'KC_MAIL', 'KC_MYCM', 'KC_CPNL', 'KC_ASST', 'KC_MCTL', 'KC_LPAD']) },
            { title: 'Browser', codes: pick(['KC_WSCH', 'KC_WHOM', 'KC_WBAK', 'KC_WFWD', 'KC_WSTP', 'KC_WREF', 'KC_WFAV']) },
          ],
        },
        {
          id: 'mouse', title: 'Mouse', groups: [
            { title: 'Movement', codes: pick(['KC_MS_U', 'KC_MS_D', 'KC_MS_L', 'KC_MS_R']) },
            { title: 'Buttons', codes: pick(range('KC_BTN', 1, 8)) },
            { title: 'Wheel', codes: pick(['KC_WH_U', 'KC_WH_D', 'KC_WH_L', 'KC_WH_R']) },
            { title: 'Acceleration', codes: pick(['KC_ACL0', 'KC_ACL1', 'KC_ACL2']) },
          ],
        },
        {
          id: 'layers', title: 'Layers',
          hint: 'Layer-tap and mod-tap go in the "Any" box, e.g. LT(1, KC_SPC) or LCTL_T(KC_ESC).',
          groups: [
            { title: 'Momentary - MO', codes: layers.map((l) => this.parse(`MO(${l})`)) },
            { title: 'Toggle - TG', codes: layers.map((l) => this.parse(`TG(${l})`)) },
            { title: 'Switch to - TO', codes: layers.map((l) => this.parse(`TO(${l})`)) },
            { title: 'Tap-toggle - TT', codes: layers.map((l) => this.parse(`TT(${l})`)) },
            { title: 'One-shot - OSL', codes: layers.map((l) => this.parse(`OSL(${l})`)) },
            { title: 'Default layer - DF', codes: layers.map((l) => this.parse(`DF(${l})`)) },
            { title: 'Tri-layer', codes: pick(['FN_MO13', 'FN_MO23']) },
          ],
        },
        {
          id: 'special', title: 'Special', groups: [
            { title: 'Firmware', codes: pick(['QK_BOOT', 'QK_RBT', 'EE_CLR', 'DB_TOGG', 'NK_TOGG']) },
            { title: 'Handy', codes: pick(['QK_GESC', 'CW_TOGG', 'SC_LSPO', 'SC_RSPC', 'SC_LCPO', 'SC_RCPC', 'SC_LAPO', 'SC_RAPC', 'SC_SENT']) },
            { title: 'Swap modifiers', codes: pick(['AG_SWAP', 'AG_NORM', 'AG_TOGG', 'CG_SWAP', 'CG_NORM', 'CG_TOGG']) },
            { title: 'Auto shift', codes: pick(['AS_TOGG', 'AS_ON', 'AS_OFF', 'AS_UP', 'AS_DOWN', 'AS_RPT']) },
            { title: 'Dynamic macros & combos', codes: pick(['DM_REC1', 'DM_REC2', 'DM_RSTP', 'DM_PLY1', 'DM_PLY2', 'CM_TOGG']) },
          ],
        },
        {
          id: 'lighting', title: 'Lighting', groups: [
            { title: 'Backlight', codes: pick(['BL_TOGG', 'BL_ON', 'BL_OFF', 'BL_UP', 'BL_DOWN', 'BL_STEP', 'BL_BRTG']) },
            { title: 'RGB', codes: pick(['RGB_TOG', 'RGB_MOD', 'RGB_RMOD', 'RGB_HUI', 'RGB_HUD', 'RGB_SAI', 'RGB_SAD', 'RGB_VAI', 'RGB_VAD', 'RGB_SPI', 'RGB_SPD']) },
            { title: 'RGB modes', codes: pick(['RGB_M_P', 'RGB_M_B', 'RGB_M_R', 'RGB_M_SW', 'RGB_M_SN', 'RGB_M_K', 'RGB_M_X', 'RGB_M_G']) },
            { title: 'RGB matrix', codes: pick(RGB_MATRIX.map((q) => q[0])) },
          ],
        },
      ];
      const macroMax = this.R.MACRO_MAX - this.R.MACRO + 1;
      const nMacros = Math.min(macroMax, macroCount || 0);
      if (nMacros > 0) {
        cats.push({
          id: 'macros', title: 'Macros', hint: 'Macro contents are edited in VIA; this app only assigns them to keys.',
          groups: [{ title: 'Macros', codes: Array.from({ length: nMacros }, (_, i) => this.R.MACRO + i) }],
        });
      }
      if (this.custom.length) {
        cats.push({
          id: 'custom', title: 'Custom', groups: [{
            title: 'From the keyboard definition',
            codes: this.custom.map((_, i) => this.R.KB + i).filter((c) => c <= this.R.KB_MAX),
          }],
        });
      }
      cats.forEach((c) => { c.groups = c.groups.filter((g) => g.codes.length); });
      return cats.filter((c) => c.groups.length);
    }
  }

  // KeyboardEvent.code -> keycode name (used by "assign by pressing a key")
  const EVENT_TO_KC = {
    Backquote: 'KC_GRV', Minus: 'KC_MINS', Equal: 'KC_EQL', Backspace: 'KC_BSPC', Tab: 'KC_TAB', BracketLeft: 'KC_LBRC',
    BracketRight: 'KC_RBRC', Backslash: 'KC_BSLS', CapsLock: 'KC_CAPS', Semicolon: 'KC_SCLN', Quote: 'KC_QUOT',
    Enter: 'KC_ENT', Comma: 'KC_COMM', Period: 'KC_DOT', Slash: 'KC_SLSH', Space: 'KC_SPC', Escape: 'KC_ESC',
    ShiftLeft: 'KC_LSFT', ShiftRight: 'KC_RSFT', ControlLeft: 'KC_LCTL', ControlRight: 'KC_RCTL', AltLeft: 'KC_LALT',
    AltRight: 'KC_RALT', MetaLeft: 'KC_LGUI', MetaRight: 'KC_RGUI', ContextMenu: 'KC_APP', IntlBackslash: 'KC_NUBS',
    PrintScreen: 'KC_PSCR', ScrollLock: 'KC_SCRL', Pause: 'KC_PAUS', Insert: 'KC_INS', Home: 'KC_HOME',
    PageUp: 'KC_PGUP', Delete: 'KC_DEL', End: 'KC_END', PageDown: 'KC_PGDN', ArrowUp: 'KC_UP', ArrowDown: 'KC_DOWN',
    ArrowLeft: 'KC_LEFT', ArrowRight: 'KC_RGHT', NumLock: 'KC_NUM', NumpadDivide: 'KC_PSLS', NumpadMultiply: 'KC_PAST',
    NumpadSubtract: 'KC_PMNS', NumpadAdd: 'KC_PPLS', NumpadEnter: 'KC_PENT', NumpadDecimal: 'KC_PDOT',
    NumpadEqual: 'KC_PEQL', NumpadComma: 'KC_PCMM', IntlRo: 'KC_INT1', KanaMode: 'KC_INT2', IntlYen: 'KC_INT3',
    Convert: 'KC_INT4', NonConvert: 'KC_INT5', Lang1: 'KC_LNG1', Lang2: 'KC_LNG2',
    AudioVolumeMute: 'KC_MUTE', AudioVolumeUp: 'KC_VOLU', AudioVolumeDown: 'KC_VOLD', MediaTrackNext: 'KC_MNXT',
    MediaTrackPrevious: 'KC_MPRV', MediaStop: 'KC_MSTP', MediaPlayPause: 'KC_MPLY',
  };
  for (let i = 0; i < 26; i++) EVENT_TO_KC['Key' + String.fromCharCode(65 + i)] = 'KC_' + String.fromCharCode(65 + i);
  for (let i = 0; i <= 9; i++) { EVENT_TO_KC['Digit' + i] = 'KC_' + i; EVENT_TO_KC['Numpad' + i] = 'KC_P' + i; }
  for (let i = 1; i <= 24; i++) EVENT_TO_KC['F' + i] = 'KC_F' + i;

  window.Keycodes = Keycodes;
  window.Keycodes.EVENT_TO_KC = EVENT_TO_KC;
  window.Keycodes.hex = hex;
  window.Keycodes.oneLine = oneLine;
})();
