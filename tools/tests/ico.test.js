const test = require('node:test');
const assert = require('node:assert');

const { buildIcoFromPng } = require('../../src/libs/ico');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('an ICO wrapper describes exactly one 256 px PNG image', () => {
    const png = Buffer.concat([PNG_HEADER, Buffer.alloc(64, 7)]);
    const ico = buildIcoFromPng(png);

    assert.strictEqual(ico.readUInt16LE(0), 0, 'reserved field');
    assert.strictEqual(ico.readUInt16LE(2), 1, 'type must be icon');
    assert.strictEqual(ico.readUInt16LE(4), 1, 'one image');
    assert.strictEqual(ico.readUInt8(6), 0, 'width 0 means 256 px');
    assert.strictEqual(ico.readUInt8(7), 0, 'height 0 means 256 px');
    assert.strictEqual(ico.readUInt16LE(10), 1, 'one colour plane');
    assert.strictEqual(ico.readUInt16LE(12), 32, '32 bit');
    assert.strictEqual(ico.readUInt32LE(14), png.length, 'payload size');
    assert.strictEqual(ico.readUInt32LE(18), 22, 'payload offset');
    assert.deepStrictEqual(ico.subarray(22), png);
});

test('non-PNG and oversized payloads are rejected', () => {
    assert.throws(() => buildIcoFromPng(Buffer.from('not a png')), /not a PNG/);
    assert.throws(() => buildIcoFromPng(Buffer.alloc(0)), /Invalid PNG payload/);
    assert.throws(() => buildIcoFromPng(Buffer.alloc(600 * 1024)), /Invalid PNG payload/);
});
