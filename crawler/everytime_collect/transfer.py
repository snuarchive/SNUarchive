"""Lossless bounded transport of a browser-returned JSON value; no network."""
import base64
import binascii
from .raw import MAX_INPUT_BYTES, ObservationError, _keys, _no_secrets, read_json


def unpack(packed):
    _keys(packed, ("codec", "utf8_length", "fnv1a64", "payload"), "transport")
    if (packed["codec"] not in ("lzw16-base64-v1", "lz77-base64-v1") or type(packed["utf8_length"]) is not int or
            not 1 <= packed["utf8_length"] <= MAX_INPUT_BYTES or not isinstance(packed["payload"], str) or
            len(packed["payload"]) > MAX_INPUT_BYTES):
        raise ObservationError("Unsupported or oversized transport")
    try:
        encoded = base64.b64decode(packed["payload"], validate=True)
        if not encoded:
            raise ValueError()
        output = bytearray()
        if packed["codec"] == "lz77-base64-v1":
            pos = 0
            while pos < len(encoded):
                control = encoded[pos]
                pos += 1
                size = control - 128 + 3 if control >= 128 else control + 1
                if len(output) + size > packed["utf8_length"]:
                    raise ValueError()
                if control >= 128:
                    distance = int.from_bytes(encoded[pos:pos + 2], "big")
                    if pos + 2 > len(encoded) or not 1 <= distance <= len(output):
                        raise ValueError()
                    pos += 2
                    for _ in range(size):
                        output.append(output[-distance])
                else:
                    if pos + size > len(encoded):
                        raise ValueError()
                    output.extend(encoded[pos:pos + size])
                    pos += size
        else:
            if len(encoded) % 2:
                raise ValueError()
            codes = [int.from_bytes(encoded[i:i + 2], "big") for i in range(0, len(encoded), 2)]
            table = [bytes([i]) for i in range(256)]
            word = table[codes[0]]
            output.extend(word)
            for code in codes[1:]:
                entry = table[code] if code < len(table) else word + word[:1] if code == len(table) else None
                if entry is None or len(output) + len(entry) > packed["utf8_length"]:
                    raise ValueError()
                output.extend(entry)
                if len(table) < 65536:
                    table.append(word + entry[:1])
                word = entry
        data = bytes(output)
        text = data.decode("utf-8")
        units = text.encode("utf-16-le")
        hash_value = 14695981039346656037
        for i in range(0, len(units), 2):
            hash_value = ((hash_value ^ int.from_bytes(units[i:i + 2], "little")) * 1099511628211) & ((1 << 64) - 1)
        if len(data) != packed["utf8_length"] or f"{hash_value:016x}" != packed["fnv1a64"]:
            raise ValueError()
    except (ValueError, IndexError, UnicodeError, binascii.Error):
        raise ObservationError("Corrupted browser transport; do not rewrite source text") from None
    _no_secrets(read_json(data))
    return data
