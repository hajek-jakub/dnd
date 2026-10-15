<?php

declare(strict_types=1);

namespace Dnd;

/** Validace vstupu z JSON těla požadavku. */
final class Input
{
    /** @param array<string, mixed> $data */
    public static function string(array $data, string $field, int $min, int $max, string $label, bool $trim = true): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value)) {
            throw HttpError::validation("$label je povinné.", $field);
        }
        if ($trim) {
            $value = trim($value);
        }
        $length = mb_strlen($value);
        if ($length < $min) {
            throw HttpError::validation($min <= 1 ? "$label je povinné." : "$label musí mít aspoň $min znaků.", $field);
        }
        if ($length > $max) {
            throw HttpError::validation("$label může mít nejvýš $max znaků.", $field);
        }
        return $value;
    }

    /** @param array<string, mixed> $data */
    public static function optionalString(array $data, string $field, int $max, string $label): ?string
    {
        if (!array_key_exists($field, $data)) {
            return null;
        }
        return self::string($data, $field, 0, $max, $label);
    }

    /** @param array<string, mixed> $data */
    public static function optionalInt(array $data, string $field, int $min, int $max, string $label): ?int
    {
        if (!array_key_exists($field, $data) || $data[$field] === null) {
            return null;
        }
        $value = $data[$field];
        if (!is_int($value) || $value < $min || $value > $max) {
            throw HttpError::validation("$label musí být celé číslo od $min do $max.", $field);
        }
        return $value;
    }

    public static function uuid(string $value, string $what = 'Záznam'): string
    {
        if (!Ids::isUuid($value)) {
            throw HttpError::notFound("$what nenalezen.");
        }
        return $value;
    }
}
