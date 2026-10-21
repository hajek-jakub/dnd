<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

/**
 * Web Push bez knihovny (Composer na Endoře nejde): VAPID podpis (RFC 8292, ES256) a šifrování obsahu aes128gcm (RFC 8291) přes OpenSSL a odeslání přes cURL.
 * Nic zde nezná databázi ani pravidla aplikace, to je v `Push`.
 */
final class WebPush
{
    /** Tvrdý strop délky zprávy: jeden záznam aes128gcm má 4096 B a Apple i FCM nad ~4 kB zprávu odmítnou. */
    public const MAX_PAYLOAD = 3000;

    public static function b64u(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function unb64u(string $text): ?string
    {
        $text = strtr($text, '-_', '+/');
        $pad = strlen($text) % 4;
        if ($pad === 1) {
            return null;
        }
        if ($pad > 0) {
            $text .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($text, true);
        return $raw === false ? null : $raw;
    }

    /** Je OpenSSL a cURL dost nový na šifrování a odesílání? */
    public static function supported(): bool
    {
        return function_exists('openssl_pkey_derive') && function_exists('openssl_pkey_new') && function_exists('curl_multi_init') && in_array('aes-128-gcm', openssl_get_cipher_methods(), true);
    }

    /** Nový klíč P-256: soukromý v PEM a veřejný jako 65 bajtů (0x04 | X | Y). @return array{pem: string, public: string} */
    public static function newKey(): array
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if ($key === false) {
            throw new RuntimeException('OpenSSL nevytvořil klíč P-256.');
        }
        openssl_pkey_export($key, $pem);
        $details = openssl_pkey_get_details($key);
        $ec = is_array($details) ? ($details['ec'] ?? null) : null;
        if (!is_array($ec) || !isset($ec['x'], $ec['y'])) {
            throw new RuntimeException('OpenSSL nevrátil podrobnosti klíče.');
        }
        return ['pem' => (string) $pem, 'public' => "\x04" . str_pad((string) $ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad((string) $ec['y'], 32, "\0", STR_PAD_LEFT)];
    }

    /** Veřejný klíč z 65 bajtů; null, když to není platný bod na křivce P-256. */
    public static function publicKeyFromRaw(string $raw): mixed
    {
        if (strlen($raw) !== 65 || $raw[0] !== "\x04") {
            return null;
        }
        $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw;
        $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
        $key = @openssl_pkey_get_public($pem);
        return $key === false ? null : $key;
    }

    /** Hlavička Authorization: vapid ... (JWT podepsaný ES256, platný 12 hodin). */
    public static function vapidHeader(string $audience, string $subject, string $pem, string $publicRaw): string
    {
        $header = self::b64u((string) json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $claims = self::b64u((string) json_encode(['aud' => $audience, 'exp' => time() + 12 * 3600, 'sub' => $subject], JSON_UNESCAPED_SLASHES));
        $input = $header . '.' . $claims;
        if (!openssl_sign($input, $der, $pem, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Podpis VAPID selhal.');
        }
        return 'vapid t=' . $input . '.' . self::b64u(self::derToRaw((string) $der)) . ', k=' . self::b64u($publicRaw);
    }

    /** Podpis ECDSA z DER (SEQUENCE { INTEGER r, INTEGER s }) na 64 bajtů r|s, jak ho chce JWT. */
    private static function derToRaw(string $der): string
    {
        $pos = 2;
        if ((ord($der[1]) & 0x80) !== 0) {
            $pos += ord($der[1]) & 0x7f;
        }
        $parts = [];
        for ($i = 0; $i < 2; $i++) {
            if (ord($der[$pos]) !== 0x02) {
                throw new RuntimeException('Neplatný podpis ECDSA.');
            }
            $len = ord($der[$pos + 1]);
            $parts[] = str_pad(ltrim(substr($der, $pos + 2, $len), "\0"), 32, "\0", STR_PAD_LEFT);
            $pos += 2 + $len;
        }
        return $parts[0] . $parts[1];
    }

    /**
     * Zašifruje obsah pro zařízení podle RFC 8291 (aes128gcm) a vrátí celé tělo požadavku (hlavička záznamu + šifrový text).
     * @param string $uaPublic  klíč p256dh zařízení (65 bajtů)
     * @param string $authSecret  tajemství auth zařízení (16 bajtů)
     */
    public static function encrypt(string $payload, string $uaPublic, string $authSecret): string
    {
        if (strlen($payload) > self::MAX_PAYLOAD) {
            throw new RuntimeException('Zpráva je na push moc dlouhá.');
        }
        $peer = self::publicKeyFromRaw($uaPublic);
        if ($peer === null || strlen($authSecret) !== 16) {
            throw new RuntimeException('Neplatný klíč zařízení.');
        }
        $local = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $details = $local === false ? false : openssl_pkey_get_details($local);
        $ec = is_array($details) ? ($details['ec'] ?? null) : null;
        if ($local === false || !is_array($ec)) {
            throw new RuntimeException('OpenSSL nevytvořil dočasný klíč.');
        }
        $asPublic = "\x04" . str_pad((string) $ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad((string) $ec['y'], 32, "\0", STR_PAD_LEFT);
        $shared = openssl_pkey_derive($peer, $local, 32);
        if ($shared === false) {
            throw new RuntimeException('Dohoda klíčů (ECDH) selhala.');
        }

        $salt = random_bytes(16);
        $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
        // Poslední (a jediný) záznam končí oddělovačem 0x02.
        $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
        if ($cipher === false) {
            throw new RuntimeException('Šifrování selhalo.');
        }
        return $salt . pack('N', 4096) . chr(strlen($asPublic)) . $asPublic . $cipher . $tag;
    }

    /**
     * Pošle všechny požadavky najednou (cURL multi), aby čekání nesčítalo odpovědi push služeb.
     * @param list<array{url: string, headers: list<string>, body: string}> $jobs
     * @param bool $allowHttp  jen testy: povolí http na napodobený server
     * @return list<array{status: int, error: string}>  stejné pořadí jako $jobs
     */
    public static function sendAll(array $jobs, bool $allowHttp = false): array
    {
        $multi = curl_multi_init();
        $handles = [];
        foreach ($jobs as $i => $job) {
            $ch = curl_init($job['url']);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $job['body'],
                CURLOPT_HTTPHEADER => $job['headers'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_TIMEOUT => 8,
                CURLOPT_PROTOCOLS => $allowHttp ? (CURLPROTO_HTTPS | CURLPROTO_HTTP) : CURLPROTO_HTTPS,
            ]);
            curl_multi_add_handle($multi, $ch);
            $handles[$i] = $ch;
        }
        $running = 0;
        do {
            curl_multi_exec($multi, $running);
            if ($running > 0 && curl_multi_select($multi, 1.0) === -1) {
                usleep(20_000);
            }
        } while ($running > 0);

        $results = [];
        foreach ($handles as $i => $ch) {
            $results[$i] = ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'error' => curl_error($ch)];
            curl_multi_remove_handle($multi, $ch);
            curl_close($ch);
        }
        curl_multi_close($multi);
        return $results;
    }
}
