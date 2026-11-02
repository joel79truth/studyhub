// src/polyfills.js
// Polyfills for modern JavaScript APIs required by libraries like PDF.js v4+/v6+
// Ensures full compatibility with Android WebViews, mobile browsers, and older Chromium engines.

if (typeof Uint8Array !== 'undefined') {
  if (!Uint8Array.prototype.toHex) {
    Uint8Array.prototype.toHex = function () {
      let hex = '';
      for (let i = 0; i < this.length; i++) {
        hex += this[i].toString(16).padStart(2, '0');
      }
      return hex;
    };
  }

  if (!Uint8Array.fromHex) {
    Uint8Array.fromHex = function (hex) {
      if (typeof hex !== 'string') throw new TypeError('Expected a string');
      if (hex.length % 2 !== 0) throw new RangeError('Expected an even length hex string');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return bytes;
    };
  }
}

if (typeof Promise !== 'undefined' && !Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
