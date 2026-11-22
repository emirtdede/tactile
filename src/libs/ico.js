// Minimal ICO writer used for the colour-tinted shortcut icon.
//
// Windows Vista and newer accept a PNG-compressed entry inside an ICO file, so
// a 22 byte header plus the renderer's PNG is a valid icon. This avoids adding
// an icon-encoding dependency just to recolour one file.
const MAX_PNG_BYTES = 512 * 1024;
const PNG_MAGIC = 0x89504e47;

/**
 * Wrap a PNG buffer into a single-image 256 px ICO file.
 * Throws when the payload is empty, too large or not a PNG.
 */
function buildIcoFromPng(pngBuffer) {
    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0 || pngBuffer.length > MAX_PNG_BYTES) {
        throw new Error('Invalid PNG payload for the shortcut icon');
    }
    if (pngBuffer.length < 8 || pngBuffer.readUInt32BE(0) !== PNG_MAGIC) {
        throw new Error('Shortcut icon payload is not a PNG file');
    }

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // image count

    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0); // width 0 means 256 px
    entry.writeUInt8(0, 1); // height 0 means 256 px
    entry.writeUInt8(0, 2); // palette entries
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngBuffer.length, 8);
    entry.writeUInt32LE(22, 12); // offset: 6 byte header + 16 byte entry

    return Buffer.concat([header, entry, pngBuffer]);
}

module.exports = { buildIcoFromPng };
