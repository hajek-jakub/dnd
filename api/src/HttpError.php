<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

/** Očekávaná chyba, která se pošle klientovi jako JSON s daným stavem. */
final class HttpError extends RuntimeException
{
    public function __construct(
        public int $status,
        public string $errorCode,
        string $message,
        public ?string $field = null,
    ) {
        parent::__construct($message);
    }

    public static function badRequest(string $message, string $code = 'bad_request'): self
    {
        return new self(400, $code, $message);
    }

    public static function unauthorized(string $message = 'Nejsi přihlášený.'): self
    {
        return new self(401, 'unauthorized', $message);
    }

    public static function forbidden(string $message = 'K tomu nemáš oprávnění.'): self
    {
        return new self(403, 'forbidden', $message);
    }

    public static function notFound(string $message = 'Nenalezeno.'): self
    {
        return new self(404, 'not_found', $message);
    }

    public static function validation(string $message, ?string $field = null): self
    {
        return new self(422, 'validation', $message, $field);
    }

    public static function tooMany(string $message = 'Příliš mnoho pokusů, zkus to později.'): self
    {
        return new self(429, 'too_many_requests', $message);
    }
}
