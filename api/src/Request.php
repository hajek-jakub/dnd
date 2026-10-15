<?php

declare(strict_types=1);

namespace Dnd;

final class Request
{
    /** @var array<string, mixed>|null */
    private ?array $json = null;

    /**
     * @param array<string, string> $headers  názvy malými písmeny
     * @param array<string, string> $cookies
     * @param array<string, mixed> $query
     */
    public function __construct(
        public string $method,
        public string $path,
        public array $headers,
        public array $cookies,
        public array $query,
        private string $rawBody,
        public string $ip,
        public bool $https,
    ) {
    }

    public static function fromGlobals(): self
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = (string) parse_url($uri, PHP_URL_PATH);
        $path = rawurldecode($path);

        // API může běžet pod prefixem (/api na Endoře, /dnd/api v podsložce); vše před "/api" se zahodí.
        $pos = strpos($path, '/api/');
        if ($pos !== false) {
            $path = substr($path, $pos + 4);
        } elseif (preg_match('#/api$#', $path) === 1) {
            $path = '/';
        }
        $path = '/' . trim($path, '/');

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (strncmp($key, 'HTTP_', 5) === 0) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower($headers['x-forwarded-proto'] ?? '') === 'https';

        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        // Jen v testovací konfiguraci: hlavička X-Test-Ip dovolí testům simulovat různé klienty
        // (jinak by se všechny testy trefovaly do jednoho rate limitu). Na ostrém serveru je vypnutá.
        if (Config::get('trust_test_ip_header', false) === true && isset($headers['x-test-ip'])) {
            $ip = $headers['x-test-ip'];
        }

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path,
            $headers,
            array_map('strval', $_COOKIE),
            $_GET,
            (string) file_get_contents('php://input'),
            // X-Forwarded-For se záměrně nepoužívá: dá se podvrhnout a rate limit by šel obejít.
            $ip,
            $https,
        );
    }

    /** @return array{tmp_name:string,size:int,error:int}|null  nahraný soubor z multipart formuláře */
    public function file(string $field): ?array
    {
        $f = $_FILES[$field] ?? null;
        if (!is_array($f) || !isset($f['tmp_name']) || is_array($f['tmp_name'])) {
            return null;
        }
        return ['tmp_name' => (string) $f['tmp_name'], 'size' => (int) ($f['size'] ?? 0), 'error' => (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE)];
    }

    /** Textové pole z multipart formuláře (u nahrávání souboru spolu s dalšími údaji). */
    public function field(string $name): ?string
    {
        $v = $_POST[$name] ?? null;
        return is_string($v) ? $v : null;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        if ($this->json !== null) {
            return $this->json;
        }
        if (trim($this->rawBody) === '') {
            return $this->json = [];
        }
        $data = json_decode($this->rawBody, true);
        if (!is_array($data) || ($data !== [] && array_keys($data) === range(0, count($data) - 1))) {
            throw HttpError::badRequest('Tělo požadavku musí být JSON objekt.');
        }
        return $this->json = $data;
    }
}
