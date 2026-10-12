// Signs a Security System "atur" (SET) command in the browser, so the device's
// console password never leaves this page. Must match the firmware exactly
// (D:\Security System\RFID\src\main.cpp, "KONFIGURASI LEWAT MQTT"):
//   K     = SHA256(salt || utf8(password))
//   plain = op 0x1F a 0x1F b
//   block i of the keystream = SHA256(K || "SSA1" || nonce || uint32BE(i))
//   data  = plain XOR keystream
//   mac   = HMAC-SHA256(K, nonce || data)

const encoder = new TextEncoder();

// Web Crypto takes BufferSource, which excludes views over a SharedArrayBuffer.
type Bytes = Uint8Array<ArrayBuffer>;

function fromHex(hex: string): Bytes {
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error('hex tidak sah');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function concat(...parts: Uint8Array[]): Bytes {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

async function sha256(data: Bytes): Promise<Bytes> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export interface SignedAtur {
    nonce: string;
    data: string;
    mac: string;
}

export async function signAtur(
    saltHex: string,
    nonceHex: string,
    password: string,
    op: string,
    a = '',
    b = '',
): Promise<SignedAtur> {
    if (!crypto?.subtle) {
        // Web Crypto only exists in a secure context (HTTPS or localhost).
        throw new Error(
            'Browser tidak menyediakan Web Crypto (halaman harus HTTPS).',
        );
    }
    const nonce = fromHex(nonceHex);
    const key = await sha256(
        concat(fromHex(saltHex), encoder.encode(password)),
    );
    const plain = encoder.encode(`${op}\x1f${a}\x1f${b}`);

    const data = new Uint8Array(plain.length);
    for (let start = 0; start < plain.length; start += 32) {
        const counter = new Uint8Array(4);
        new DataView(counter.buffer).setUint32(0, start / 32);
        const block = await sha256(
            concat(key, encoder.encode('SSA1'), nonce, counter),
        );
        for (let i = start; i < Math.min(start + 32, plain.length); i++) {
            data[i] = plain[i] ^ block[i - start];
        }
    }

    const hmacKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const mac = new Uint8Array(
        await crypto.subtle.sign('HMAC', hmacKey, concat(nonce, data)),
    );

    return { nonce: nonceHex, data: toHex(data), mac: toHex(mac) };
}
