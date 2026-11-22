function remapper(from = 'standard', to = 'darwin', defines = {}) {
  if (from === 'standard') {
    // from standard linux, darwin, win32
    switch (to) {
      case 'linux':
        break;
      case 'darwin': {
        // Read every source value from an untouched snapshot. The old code
        // read back keys it had already overwritten (e.g. 56 and 3675 were
        // assigned from themselves), so the result depended on statement
        // order and the F13 mapping was silently destroyed by a second
        // assignment to the same key (91).
        const source = { ...defines };
        defines['91'] = source['3639']; // mac f13
        defines['92'] = source['70']; // mac f14
        defines['93'] = source['3653']; // mac f15

        defines['56'] = source['3676'];
        defines['3675'] = source['3640'];
        defines['29'] = source['3613'];

        defines['3597'] = source['69']; // numlock -> clear
        break;
      }
      case 'win32': {
        // row 2
        defines['61010'] = defines['3666'];
        defines['60999'] = defines['3655'];
        defines['61001'] = defines['3657'];
        // row 3
        defines['61011'] = defines['3667'];
        defines['61007'] = defines['3663'];
        defines['61009'] = defines['3665'];
        defines['3677'] = defines['3613'];
        // row 4
        defines['61000'] = defines['57416'];
        // row 5
        defines['61003'] = defines['57419'];
        defines['61008'] = defines['57424'];
        defines['61005'] = defines['57421'];
        break;
      }
    }
  } else {
    // from linux, darwin, win32 to standard
    switch (from) {
      case 'darwin': {
        // Same trap as the forward direction: several targets overlap with
        // sources (56/3675/3676/3640), so read from an untouched snapshot.
        const source = { ...defines };
        defines['3639'] = source['91'];   // mac f13
        defines['70'] = source['92'];     // mac f14
        defines['3653'] = source['93'];   // mac f15
        defines['3676'] = source['56'];   // Command
        defines['3640'] = source['3675']; // Option
        defines['3613'] = source['29'];   // Ctrl
        defines['69'] = source['3597'];   // clear -> numlock
        break;
      }
      case 'win32': {
        // row 2
        defines['3666'] = defines['61010'];
        defines['3655'] = defines['60999'];
        defines['3657'] = defines['61001'];
        // row 3
        defines['3667'] = defines['61011'];
        defines['3663'] = defines['61007'];
        defines['3665'] = defines['61009'];
        // row 4
        defines['57416'] = defines['61000'];
        // row 5
        defines['57419'] = defines['61003'];
        defines['57424'] = defines['61008'];
        defines['57421'] = defines['61005'];
        break;
      }
    }
  }
  return defines;
}

module.exports = remapper;
