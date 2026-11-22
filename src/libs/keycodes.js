'use strict';
const standard = {
  1: 'Esc',

  59: 'F1',
  60: 'F2',
  61: 'F3',
  62: 'F4',
  63: 'F5',
  64: 'F6',
  65: 'F7',
  66: 'F8',
  67: 'F9',
  68: 'F10',
  87: 'F11',
  88: 'F12',

  91: 'F13',
  92: 'F14',
  93: 'F15',

  41: '`',

  2: '1',
  3: '2',
  4: '3',
  5: '4',
  6: '5',
  7: '6',
  8: '7',
  9: '8',
  10: '9',
  11: '0',

  12: '-',
  13: '=',
  14: 'Backspace',

  15: 'Tab',
  58: 'CapsLock',

  30: 'A',
  48: 'B',
  46: 'C',
  32: 'D',
  18: 'E',
  33: 'F',
  34: 'G',
  35: 'H',
  23: 'I',
  36: 'J',
  37: 'K',
  38: 'L',
  50: 'M',
  49: 'N',
  24: 'O',
  25: 'P',
  16: 'Q',
  19: 'R',
  31: 'S',
  20: 'T',
  22: 'U',
  47: 'V',
  17: 'W',
  45: 'X',
  21: 'Y',
  44: 'Z',

  26: '[',
  27: ']',
  43: '\\',

  39: ';',
  40: "'",
  28: 'Enter',

  51: ',',
  52: '.',
  53: '/',

  57: 'Space',

  3639: 'PrtSc',
  70: 'ScrLk',
  3653: 'Pause',

  3666: 'Ins',
  3667: 'Del',
  3655: 'Home',
  3663: 'End',
  3657: 'PgUp',
  3665: 'PgDn',

  57416: '↑',
  57419: '←',
  57421: '→',
  57424: '↓',

  42: 'Shift',
  54: 'Shift',
  29: 'Ctrl',
  3613: 'Ctrl',
  56: 'Alt',
  3640: 'Alt',
  3675: 'Meta',
  3676: 'Meta',
  3677: 'Menu',

  // Numpad
  69: 'Num\nLock',
  3637: '/', // Numpad
  55: '*', // Numpad
  74: '-', // Numpad
  3597: '=', // Numpad
  78: '+', // Numpad
  3612: 'Enter', // Numpad
  83: '.', // Numpad

  79: '1', // Numpad
  80: '2', // Numpad
  81: '3', // Numpad
  75: '4', // Numpad
  76: '5', // Numpad
  77: '6', // Numpad
  71: '7', // Numpad
  72: '8', // Numpad
  73: '9', // Numpad
  82: '0', // Numpad
};

const darwin = JSON.parse(JSON.stringify(standard));
Object.assign(darwin, {
  28: 'Return',
  56: 'Option',
  69: 'Clear',
  3640: 'Option',
  3666: 'Fn',
  3675: 'Command',
  3676: 'Command',
});

const win32 = JSON.parse(JSON.stringify(standard));
Object.assign(win32, {
  3675: 'Win',
  3676: 'Win',
  61010: 'Ins',
  61011: 'Del',
  60999: 'Home',
  61007: 'End',
  61001: 'PgUp',
  61009: 'PgDn',
  61000: '↑',
  61003: '←',
  61005: '→',
  61008: '↓',
});

const linux = JSON.parse(JSON.stringify(standard));

// ==================================================
// remap keycodes from standard to os based keycodes
function keycodesRemap(defines) {
  const remapper = require('../utils/remapper');

  // The map holds both "3666" (keydown) and "3666-up" (keyup) entries. Only
  // the numeric part may go through the remapper: feeding it "3666-up" left
  // that key untouched, so the keyup sound stayed on the standard keycode and
  // never fired on win32/darwin (the hook reports the remapped keycode).
  const numeric = {};
  const keyup = {};
  const passthrough = {};

  Object.keys(defines).forEach((key) => {
    const match = /^(\d+)(-up)?$/.exec(key);
    if (!match) {
      passthrough[key] = defines[key];
      return;
    }
    if (match[2]) keyup[match[1]] = defines[key];
    else numeric[match[1]] = defines[key];
  });

  const remappedDown = remapper('standard', process.platform, { ...numeric });
  const remappedUp = remapper('standard', process.platform, { ...keyup });

  // forEach, not map: the return value was always discarded.
  const sprite = {};
  Object.entries(remappedDown).forEach(([kc, value]) => {
    sprite[`keycode-${kc}`] = value;
  });
  Object.entries(remappedUp).forEach(([kc, value]) => {
    sprite[`keycode-${kc}-up`] = value;
  });
  Object.entries(passthrough).forEach(([kc, value]) => {
    sprite[`keycode-${kc}`] = value;
  });
  return sprite;
}

function keycodesFill(defines){
  let keys = {...defines};
  Object.keys(standard).forEach((kc) => {
    if(!keys[kc]){
      keys[kc] = null;
    }
  });
  return keys;
}

module.exports = { darwin, win32, linux, keycodesRemap, keycodesFill };
