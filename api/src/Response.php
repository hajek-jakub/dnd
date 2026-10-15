<?php

declare(strict_types=1);

namespace Dnd;

final class Response
{
    /** @param array<string, mixed>|list<mixed>|null $body */
    public function __construct(
        public int $status = 200,
        public ?array $body = null,
        /** Binární tělo (obrázek) místo JSON; nastaví se i Content-Type. */
        public ?string $raw = null,
        public ?string $contentType = null,
        /** @var array<string, string> */
        public array $headers = [],
    ) {
    }

    /** @param array<string, string> $headers */
    public static function binary(string $bytes, string $contentType, array $headers = []): self
    {
        return new self(200, null, $bytes, $contentType, $headers);
    }

    /** @param array<string, mixed>|list<mixed> $data */
    public static function json(array $data, int $status = 200): self
    {
        return new self($status, $data);
    }

    public static function noContent(): self
    {
        return new self(204, null);
    }

    public static function error(int $status, string $code, string $message, ?string $field = null, ?string $detail = null): self
    {
        $error = ['code' => $code, 'message' => $message];
        if ($field !== null) {
            $error['field'] = $field;
        }
        if ($detail !== null) {
            $error['detail'] = $detail;
        }
        return new self($status, ['error' => $error]);
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        if ($this->raw !== null) {
            header('Content-Type: ' . ($this->contentType ?? 'application/octet-stream'));
            header('Content-Length: ' . strlen($this->raw));
            echo $this->raw;
            return;
        }
        if ($this->body !== null && $this->status !== 204) {
            $json = json_encode($this->body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            // Větší odpovědi (seznam postav, pravidla) se komprimují sami, protože mod_deflate na sdíleném hostingu není jistota.
            $accepts = (string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '');
            if (strlen($json) > 1024 && str_contains($accepts, 'gzip') && function_exists('gzencode') && !headers_sent()) {
                $packed = gzencode($json, 5);
                if ($packed !== false) {
                    header('Content-Encoding: gzip');
                    header('Vary: Accept-Encoding');
                    header('Content-Length: ' . strlen($packed));
                    echo $packed;
                    return;
                }
            }
            echo $json;
        }
    }
}
