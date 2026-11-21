'use client'

import { injectStyles } from '@a2ui/react/styles'
import { A2uiSurface, MarkdownComponentContext, type ReactCatalogComponent } from '@a2ui/react/v0_9'
import { MessageProcessor, type ProcessableMessagePayload } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { useAuiState } from '@assistant-ui/react'
import { useEffect, useMemo, useRef } from 'react'

import { fromA2uiActionPayload } from '@/lib/a2ui-actions'
import { extractA2uiEnvelopes } from '@/lib/a2ui-surface'

import type { RichFenceProps } from './types'
import { type A2uiActionDispatch, useA2uiActionDispatch } from './use-a2ui-action'

// A2UI transcript surface: renders a ```a2ui fence through the real
// `@a2ui/react` renderer (v0.9 line) behind the same lazy rich-fence
// boundary. The fence body is a JSON envelope list; `extractA2uiEnvelopes`
// throws on partial JSON (streaming state) or schema drift, so RichBoundary
// falls back to the fence source — the scroll never crashes. Button taps
// submit a visible `prompt.submit` follow-up on the owning session (the
// action loop); inputs stay display-only until the P3 authoring convention
// lands. Unknown catalog components are a processor error, i.e. source
// fallback, never a blank card.

/** P1 parity: plain-text rendering for catalog Text (no nested markdown pass). */
function PlainMarkdown({ markdown }: { markdown: string }) {
  return <>{markdown}</>
}

export interface A2uiEmbedProps extends RichFenceProps {
  /** Test seam: stub dispatch instead of the session-bound hook. */
  dispatch?: A2uiActionDispatch
}

function A2uiEmbedInner({ code, dispatch: dispatchOverride }: A2uiEmbedProps) {
  const messageId = useAuiState(s => s.message.id) ?? 'unkeyed'
  const liveDispatch = useA2uiActionDispatch()
  const dispatch = dispatchOverride ?? liveDispatch
  const dispatchRef = useRef(dispatch)

  dispatchRef.current = dispatch

  useEffect(() => {
    injectStyles()
  }, [])

  const bound = useMemo(() => {
    const envelopes = extractA2uiEnvelopes(code)

    // Explicit ReactCatalogComponent: the constructor takes Catalog<any>[]
    // so inference would fall back to broad ComponentApi, which the
    // renderer's surface prop rejects. Basic entries are WebComponent
    // implementations (a union member), hosted at runtime.
    const processor = new MessageProcessor<ReactCatalogComponent>([basicCatalog], payload => {
      dispatchRef.current.submit(fromA2uiActionPayload(messageId, payload))
    })

    // Structurally gated above; the processor remains the schema authority
    // and throws on anything it rejects (boundary shows source).
    processor.processMessages(envelopes.messages as unknown as ProcessableMessagePayload)

    return { processor, surfaceId: envelopes.surfaceId }
  }, [code, messageId])

  useEffect(() => () => bound.processor.dispose(), [bound])

  const surface = bound.processor.getSurface(bound.surfaceId)

  if (!surface) {
    return null
  }

  return (
    <div className="my-1.5 w-full" data-slot="aui_a2ui-surface" data-surface={bound.surfaceId}>
      <MarkdownComponentContext.Provider value={PlainMarkdown}>
        <A2uiSurface surface={surface} />
      </MarkdownComponentContext.Provider>
    </div>
  )
}

export default function A2uiEmbed(props: RichFenceProps) {
  return <A2uiEmbedInner {...props} />
}
