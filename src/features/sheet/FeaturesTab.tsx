import { Link } from 'react-router-dom'
import { groupClasses } from '@/engine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { useClassFeatures } from './api'
import { toEngineInput } from './model'
import { useSheet } from './sheet-context'

/** Featury tříd a subclass až do aktuálního levelu, s popisy ze SRD. */
export function FeaturesTab() {
  const { character, bundle } = useSheet()
  const classes = groupClasses(toEngineInput(character))
  return (
    <div className="space-y-4">
      {classes.map((c) => (
        <ClassFeatures
          key={c.classIndex}
          classIndex={c.classIndex}
          level={c.level}
          subclassIndex={c.subclassIndex ?? undefined}
          className={bundle.classes[c.classIndex]?.name ?? c.classIndex}
        />
      ))}
      {character.extraProficiencies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Další proficiencies</CardTitle>
          </CardHeader>
          <CardContent>{character.extraProficiencies.join(', ')}</CardContent>
        </Card>
      )}
    </div>
  )
}

function ClassFeatures({
  classIndex,
  level,
  subclassIndex,
  className,
}: {
  classIndex: string
  level: number
  subclassIndex?: string
  className: string
}) {
  const { data, isPending, error } = useClassFeatures(classIndex, level, subclassIndex)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {className} {level}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isPending && <p className="text-muted-foreground">Načítám…</p>}
        {error && <p role="alert">Featury se nepodařilo načíst.</p>}
        {data?.length === 0 && <p className="text-muted-foreground">Žádné featury.</p>}
        {data?.map((f) => (
          <details key={`${f.source}-${f.id}-${f.level}`} className="group rounded-lg border">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 font-medium">
              <span>
                <span>{f.name}</span>
                {f.source === 'subclass' && <span className="ml-2 text-xs font-normal text-muted-foreground">({f.className})</span>}
              </span>
              <span className="text-xs font-normal text-muted-foreground">level {f.level}</span>
            </summary>
            <div className="space-y-3 border-t px-3 py-3 text-sm">
              <DescriptionText text={f.description} />
              <Link to={`/rules/${f.id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                Otevřít v pravidlech
              </Link>
            </div>
          </details>
        ))}
      </CardContent>
    </Card>
  )
}
