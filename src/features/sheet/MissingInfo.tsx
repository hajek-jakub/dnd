import { Card, CardContent } from '@/components/ui/card'
import { NotFilled } from './NotesText'
import { unconfirmedLines } from './unconfirmed'
import { useSheet } from './sheet-context'

/** Co na postavě chybí (null / prázdné) a co čeká na potvrzení (TO_CONFIRM v poznámkách). Zmizí, až je všechno doplněno. */
export function MissingInfo() {
  const { character } = useSheet()
  const missing = [
    character.background.trim() === '' ? 'background' : null,
    character.alignment.trim() === '' ? 'alignment' : null,
    character.xp === null ? 'XP' : null,
  ].filter((x): x is string => x !== null)
  const toConfirm = [
    ...unconfirmedLines(character.notes).map((t) => ({ where: 'Postava', text: t })),
    ...character.items.flatMap((i) => unconfirmedLines(i.notes).map((t) => ({ where: i.name, text: t }))),
  ]
  if (missing.length === 0 && toConfirm.length === 0) return null

  return (
    <Card className="border-amber-500/60">
      <CardContent className="space-y-2 p-4 text-sm">
        {missing.length > 0 && (
          <p data-testid="missing-info">
            <strong>Nedoplněno:</strong> {missing.join(', ')} <NotFilled>(doplň na záložce Postava)</NotFilled>
          </p>
        )}
        {toConfirm.length > 0 && (
          <div>
            <p className="font-medium">Ke ověření ({toConfirm.length}):</p>
            <ul className="list-disc space-y-1 pl-5">
              {toConfirm.map((t, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{t.where}: </span>
                  {t.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
