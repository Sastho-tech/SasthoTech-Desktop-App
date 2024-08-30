if (typeof atob === 'undefined') {
  global.atob = function(b64Encoded) {
    return Buffer.from(b64Encoded, 'base64').toString('binary');
  };
}

module.exports = {};  // Th