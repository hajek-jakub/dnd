import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { useDeleteNote, useDmNotes, useSaveNote } from './api'

/** Soukromé poznámky DM (k celé kampani nebo k jedné postavě). Hráči je nikdy nedostanou. */
export function NotesPanel({ campaignId, characters }: { campaignId: string; characters: { id: string; name: string }[] }) {
  const { data: notes } = useDmNotes(campaignId)
  const save = useSaveNote(campaignId)
  const remove = useDeleteNote(campaignId)
  const [body, setBody] = useState('')
  const [characterId, setCharacterId] = useState('')
  const nameOf = (id: string | null) => characters.find((c) => c.id === id)?.name

  function add() {
    if (!body.trim()) return
    save.mutate(
      { body: body.trim(), characterId: characterId || null },
      {
        onSuccess: () => {
          setBody('')
          toast.success('Poznámka uložena')
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Poznámku se nepodařilo uložit.'),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Poznámky DM</CardTitle>
        <p className="text-sm text-muted-foreground">Vidíš je jen ty. Hráči je nedostanou, ani když se podívají do sítě.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <Label htmlFor="dm-note-body">Nová poznámka</Label>
          <Textarea id="dm-note-body" rows={3} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <NativeSelect aria-label="K postavě" className="min-w-0 flex-1" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">Obecná poznámka</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  K postavě: {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" disabled={!body.trim() || save.isPending}>
              Uložit poznámku
            </Button>
          </div>
        </form>
        {notes?.length === 0 && <p className="text-sm text-muted-foreground">Zatím žádné poznámky.</p>}
        <ul className="space-y-2">
          {notes?.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                {nameOf(n.characterId) && <p className="text-xs font-medium text-muted-foreground">{nameOf(n.characterId)}</p>}
                <p className="whitespace-pre-line break-words">{n.body}</p>
                <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Smazat poznámku"
                title="Smazat poznámku"
                onClick={() => {
                  if (window.confirm('Smazat poznámku?')) remove.mutate(n.id)
                }}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
