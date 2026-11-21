import { useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useCallback, useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useI18n } from '@/i18n'
import { type A2uiOutboundAction, a2uiSubmitParams } from '@/lib/a2ui-actions'
import { notifyError } from '@/store/notifications'
import { requestForOwnedSession } from '@/store/session-states'

export type A2uiActionState = 'idle' | 'busy' | 'pending' | 'sent'

export interface A2uiActionDispatch {
  state: (action: A2uiOutboundAction) => A2uiActionState
  submit: (action: A2uiOutboundAction) => void
}

// Terminal + in-flight keys survive remounts: the streaming transcript
// remounts the fence on every delta, and a useState latch would forget a
// sent action and let the replayed surface submit twice.
const sentKeys = new Set<string>()
const pendingKeys = new Set<string>()

export function resetA2uiActionStateForTests(): void {
  sentKeys.clear()
  pendingKeys.clear()
}

/**
 * Renderer-side half of the action loop. Delivery is a visible user
 * follow-up through the session owner's `prompt.submit` (owner-routed and
 * fail-closed; explicit `submission_id` for gateway dedupe). The turn runs
 * while a sibling turn is live is refused client-side: the fence disables
 * instead of queueing, so P2 never reimplements the composer's queue.
 */
export function useA2uiActionDispatch(): A2uiActionDispatch {
  const { t } = useI18n()
  const view = useSessionView()
  const sessionId = useStore(view.$runtimeId)
  const { requestGateway } = useGatewayRequest()
  const threadRunning = useAuiState(s => Boolean(s.thread.isRunning))
  const [, bump] = useState(0)
  const refresh = useCallback(() => bump(n => n + 1), [])

  const submit = useCallback(
    (action: A2uiOutboundAction) => {
      if (sentKeys.has(action.key) || pendingKeys.has(action.key) || threadRunning) {
        return
      }

      if (!sessionId) {
        return
      }

      pendingKeys.add(action.key)
      refresh()
      void requestForOwnedSession<{ status?: string }>(
        sessionId,
        requestGateway,
        'prompt.submit',
        a2uiSubmitParams(sessionId, action)
      ).then(
        () => {
          pendingKeys.delete(action.key)
          sentKeys.add(action.key)
          refresh()
        },
        (error: unknown) => {
          pendingKeys.delete(action.key)
          refresh()
          notifyError(error, t.assistant.a2ui.sendFailed)
        }
      )
    },
    [sessionId, requestGateway, threadRunning, refresh, t]
  )

  const state = useCallback(
    (action: A2uiOutboundAction): A2uiActionState => {
      if (sentKeys.has(action.key)) {
        return 'sent'
      }

      if (pendingKeys.has(action.key)) {
        return 'pending'
      }

      if (threadRunning) {
        return 'busy'
      }

      return 'idle'
    },
    [threadRunning]
  )

  return useMemo(() => ({ state, submit }), [state, submit])
}
