// Pure lossless data transport; no browser, filesystem, network, or text rewriting.
(function packObservation(value) {
  const text = JSON.stringify(value), data = unescape(encodeURIComponent(text));
  if (data.length > 2 * 1024 * 1024) throw new Error("Transfer size limit");
  let hash = 14695981039346656037n;
  for (let i = 0; i < text.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 1099511628211n);
  const bytes = [], index = new Map(); let literals = [];
  const flush = () => { if (literals.length) { bytes.push(literals.length - 1, ...literals); literals = []; } };
  const remember = p => {
    const key = data.slice(p, p + 3), list = index.get(key) || [];
    list.push(p); if (list.length > 64) list.shift(); index.set(key, list);
  };
  for (let p = 0; p < data.length;) {
    let length = 0, distance = 0;
    for (const q of (index.get(data.slice(p, p + 3)) || []).slice().reverse()) {
      if (p - q > 65535) break;
      let size = 0;
      while (size < 130 && p + size < data.length && data[q + size] === data[p + size]) size++;
      if (size > length) { length = size; distance = p - q; }
      if (length === 130) break;
    }
    if (length >= 4) {
      flush(); bytes.push(128 + length - 3, distance >> 8, distance & 255);
      for (let n = 0; n < length; n++) remember(p++);
    } else {
      literals.push(data.charCodeAt(p)); remember(p++); if (literals.length === 128) flush();
    }
  }
  flush();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let payload = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    payload += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? alphabet[n & 63] : "=");
  }
  return { codec: "lz77-base64-v1", utf8_length: data.length, fnv1a64: hash.toString(16).padStart(16, "0"), payload };
})
