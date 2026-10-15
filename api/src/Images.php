<?php

declare(strict_types=1);

namespace Dnd;

/** Bezpečné zpracování nahraných obrázků: ověří, že jde opravdu o obrázek, a přegeneruje ho (zahodí metadata i případný škodlivý obsah). */
final class Images
{
    private const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
    private const MAX_SOURCE_PIXELS = 40_000_000;

    /**
     * Nahraje obrázek z formuláře, ořízne na čtverec a zmenší na $size px, uloží jako JPEG.
     * @param array{tmp_name:string,size:int,error:int}|null $file
     */
    public static function squareJpeg(?array $file, int $size = 512): string
    {
        $img = self::decode($file);
        $w = imagesx($img);
        $h = imagesy($img);
        $side = min($w, $h);
        $cropped = imagecrop($img, ['x' => intdiv($w - $side, 2), 'y' => intdiv($h - $side, 2), 'width' => $side, 'height' => $side]);
        if ($cropped === false) {
            throw HttpError::validation('Obrázek se nepodařilo zpracovat.', 'photo');
        }
        $out = imagecreatetruecolor($size, $size);
        imagefill($out, 0, 0, (int) imagecolorallocate($out, 255, 255, 255));
        imagecopyresampled($out, $cropped, 0, 0, 0, 0, $size, $size, $side, $side);
        return self::jpeg($out, 85);
    }

    /** Pro mapy: zachová poměr stran, zmenší na nejvýše $maxSide px na delší straně. @param array{tmp_name:string,size:int,error:int}|null $file @return array{bytes:string,width:int,height:int} */
    public static function scaledJpeg(?array $file, int $maxSide = 4096): array
    {
        $img = self::decode($file);
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1.0, $maxSide / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $out = imagecreatetruecolor($nw, $nh);
        imagefill($out, 0, 0, (int) imagecolorallocate($out, 255, 255, 255));
        imagecopyresampled($out, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        return ['bytes' => self::jpeg($out, 82), 'width' => $nw, 'height' => $nh];
    }

    /** @param array{tmp_name:string,size:int,error:int}|null $file */
    private static function decode(?array $file): \GdImage
    {
        if (!function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) {
            throw new HttpError(501, 'gd_missing', 'Server nepodporuje zpracování obrázků (chybí rozšíření GD v PHP).');
        }
        if ($file === null || $file['error'] === UPLOAD_ERR_NO_FILE) {
            throw HttpError::validation('Vyber obrázek.', 'photo');
        }
        if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE || $file['size'] > self::MAX_UPLOAD_BYTES) {
            throw HttpError::validation('Obrázek je příliš velký (nejvýš 8 MB).', 'photo');
        }
        if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            throw HttpError::validation('Nahrání se nepovedlo, zkus to znovu.', 'photo');
        }
        $bytes = (string) file_get_contents($file['tmp_name']);
        $info = @getimagesizefromstring($bytes);
        if ($info === false || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) {
            throw HttpError::validation('Soubor není obrázek (povolené jsou JPEG, PNG, WebP a GIF).', 'photo');
        }
        if ($info[0] * $info[1] > self::MAX_SOURCE_PIXELS) {
            throw HttpError::validation('Obrázek má příliš velké rozlišení.', 'photo');
        }
        $img = @imagecreatefromstring($bytes);
        if ($img === false) {
            throw HttpError::validation('Obrázek je poškozený.', 'photo');
        }
        return $img;
    }

    private static function jpeg(\GdImage $img, int $quality): string
    {
        ob_start();
        imagejpeg($img, null, $quality);
        return (string) ob_get_clean();
    }

    /** Uloží bytes do storage/<podsložka>/<soubor> a vrátí relativní cestu. */
    public static function store(string $subdir, string $filename, string $bytes): string
    {
        $dir = Config::storageDir() . '/' . $subdir;
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new HttpError(500, 'storage_unavailable', 'Server nemůže ukládat soubory (nelze vytvořit složku).');
        }
        if (@file_put_contents($dir . '/' . $filename, $bytes) === false) {
            throw new HttpError(500, 'storage_unavailable', 'Server nemůže ukládat soubory (složka není zapisovatelná).');
        }
        return $subdir . '/' . $filename;
    }

    public static function read(string $relative): ?string
    {
        if (!preg_match('#^[a-z]+/[a-zA-Z0-9._-]+$#', $relative)) {
            return null;
        }
        $path = Config::storageDir() . '/' . $relative;
        return is_file($path) ? (string) file_get_contents($path) : null;
    }

    public static function delete(?string $relative): void
    {
        if ($relative !== null && preg_match('#^[a-z]+/[a-zA-Z0-9._-]+$#', $relative)) {
            @unlink(Config::storageDir() . '/' . $relative);
        }
    }
}
