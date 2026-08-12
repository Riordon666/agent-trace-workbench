const zlib = require('zlib');

function parseContentEncodings(value) {
  return String(value || '')
    .split(',')
    .map((encoding) => encoding.trim().toLowerCase())
    .filter((encoding) => encoding && encoding !== 'identity');
}

function createDecoder(encoding) {
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip();
  if (encoding === 'deflate') return zlib.createInflate();
  if (encoding === 'br') return zlib.createBrotliDecompress();
  if (encoding === 'zstd' && typeof zlib.createZstdDecompress === 'function') return zlib.createZstdDecompress();
  return null;
}

function supportsEncoding(encoding) {
  return encoding === 'gzip'
    || encoding === 'x-gzip'
    || encoding === 'deflate'
    || encoding === 'br'
    || (encoding === 'zstd' && typeof zlib.createZstdDecompress === 'function');
}

function createDecodedResponseStream(source, contentEncoding) {
  const encodings = parseContentEncodings(contentEncoding);
  const decoders = encodings.map((encoding) => ({ encoding, stream: createDecoder(encoding) }));
  const unsupported = decoders.find((decoder) => !decoder.stream)?.encoding || '';
  if (unsupported) {
    return {
      stream: source,
      encodings,
      decoded: false,
      error: `不支持的响应编码: ${unsupported}`,
    };
  }

  let stream = source;
  for (const decoder of decoders.reverse()) stream = stream.pipe(decoder.stream);
  return {
    stream,
    encodings,
    decoded: encodings.length > 0,
    error: '',
  };
}

function supportedAcceptEncoding(value) {
  const requested = parseContentEncodings(value);
  const supported = requested.filter(supportsEncoding);
  return supported.length ? supported.join(', ') : 'identity';
}

module.exports = {
  createDecodedResponseStream,
  parseContentEncodings,
  supportsEncoding,
  supportedAcceptEncoding,
};
