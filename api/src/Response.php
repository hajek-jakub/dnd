<?php

declare(strict_types=1);

namespace Dnd;

final class Response
{
    /** @param array<string, mixed>|list<mixed>|null $body */
    public function __construct(
        public int $status = 200,
        public ?array $body = null,
    ) {
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
        if ($this->body !== null && $this->status !== 204) {
            echo json_encode($this->body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        }
    }
}
