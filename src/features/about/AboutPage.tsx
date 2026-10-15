import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Veřejná stránka (bez přihlášení) s povinnou atribucí SRD 5.1 a poděkováním zdrojům dat. */
export function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 pb-16">
      <Link to="/" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
        ← D&amp;D kampaně
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">O aplikaci</h1>
      <p className="text-muted-foreground">
        Soukromá webová aplikace pro naši D&amp;D skupinu: character sheet, DM panel, pravidla a obsah. Není určená k veřejnému
        sdílení ani k prodeji.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Atribuce SRD 5.1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 leading-relaxed">
          <p>
            This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and
            available at{' '}
            <a
              className="underline underline-offset-4"
              href="https://dnd.wizards.com/resources/systems-reference-document"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://dnd.wizards.com/resources/systems-reference-document
            </a>
            . The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at{' '}
            <a
              className="underline underline-offset-4"
              href="https://creativecommons.org/licenses/by/4.0/legalcode"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://creativecommons.org/licenses/by/4.0/legalcode
            </a>
            .
          </p>
          <p className="text-sm text-muted-foreground">
            Herní obsah označený „SRD 5.1“ (kouzla, itemy, třídy, featury a další) je převzatý beze změn v angličtině.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zdroje dat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 leading-relaxed">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Strukturovaná data SRD pochází z projektu{' '}
              <a
                className="underline underline-offset-4"
                href="https://github.com/5e-bits/5e-database"
                target="_blank"
                rel="noopener noreferrer"
              >
                5e-bits/5e-database
              </a>
              .
            </li>
            <li>
              Seznam magických itemů mimo SRD (jen název, typ, vzácnost, attunement a zdroj) vychází z{' '}
              <a
                className="underline underline-offset-4"
                href="https://www.aidedd.org/dnd-filters/magic-items.php"
                target="_blank"
                rel="noopener noreferrer"
              >
                aidedd.org
              </a>
              . Popisy těchto itemů aplikace nekopíruje, odkazuje na jejich stránky.
            </li>
            <li>
              Orientační ceny magických itemů jsou z ceníku{' '}
              <a
                className="underline underline-offset-4"
                href="https://app.eventyrgames.com/pricelist"
                target="_blank"
                rel="noopener noreferrer"
              >
                Eventyr Games
              </a>
              . Jsou to doporučené hodnoty, DM je může libovolně změnit.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            D&amp;D a Dungeons &amp; Dragons jsou ochranné známky Wizards of the Coast LLC. Aplikace s nimi není nijak spojená.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
