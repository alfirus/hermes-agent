// One-shot "welcome back" re-orientation chip for returning users: when the
// running desktop version differs from the last version this profile already
// saw, a small banner floats at the top of the primary chat surface with the
// new version and a link to the GitHub release notes. Render-only — it never
// blocks or steals focus from the composer. Shown exactly once per new
// version (acknowledged on first paint, and on dismiss), per profile.
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { ArrowUpRight, X } from '@/lib/icons'
import { $activeGatewayProfile } from '@/store/profile'
import { $sessions, $sessionsLoading } from '@/store/session'
import { $desktopVersion, refreshDesktopVersion } from '@/store/updates'
import {
  acknowledgedWelcomeVersion,
  acknowledgeWelcomeVersion,
  RELEASE_NOTES_URL,
  shouldShowWelcomeBack
} from '@/store/welcome-back'

export function WelcomeBackNote() {
  const { t } = useI18n()
  const version = useStore($desktopVersion)
  const profile = useStore($activeGatewayProfile)
  const sessions = useStore($sessions)
  const sessionsLoading = useStore($sessionsLoading)
  const [dismissed, setDismissed] = useState(false)

  // The updates poller may not have populated the bridge yet on a cold chat
  // mount; kick one refresh so the note can appear without waiting for focus.
  useEffect(() => {
    if (!version) {
      void refreshDesktopVersion()
    }
  }, [version])

  const appVersion = version?.appVersion ?? ''
  // Returning-user gate: the session list has hydrated AND has history. A
  // first-run profile (empty list) never sees a "welcome back", and while the
  // list is still loading the note stays down (no flash-then-hide).
  const hasHistory = !sessionsLoading && sessions.length > 0

  const show =
    !dismissed &&
    shouldShowWelcomeBack({
      acknowledgedVersion: acknowledgedWelcomeVersion(profile),
      appVersion,
      hasHistory
    })

  // Showing once IS the acknowledgement: a relaunch on the same version must
  // not repeat the note ("exactly once per new version", even undimissed).
  useEffect(() => {
    if (show && appVersion) {
      acknowledgeWelcomeVersion(profile, appVersion)
    }
  }, [appVersion, profile, show])

  if (!show) {
    return null
  }

  const shortCommit = version?.commit?.trim().slice(0, 7) ?? ''
  const label = shortCommit ? `${appVersion} (${shortCommit})` : appVersion

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border border-border/65 bg-(--composer-fill) px-3.5 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-[0.75rem]">
        <span className="truncate">
          {t.desktop.welcomeBackUpdated} <span className="font-medium text-foreground">{label}</span>
        </span>
        <Button
          onClick={() => {
            setDismissed(true)
            acknowledgeWelcomeVersion(profile, appVersion)
            void window.hermesDesktop?.openExternal?.(RELEASE_NOTES_URL)
          }}
          size="xs"
          variant="ghost"
        >
          {t.desktop.welcomeBackChanges}
          <ArrowUpRight aria-hidden size={12} />
        </Button>
        <Button
          aria-label={t.desktop.welcomeBackDismiss}
          onClick={() => {
            setDismissed(true)
            acknowledgeWelcomeVersion(profile, appVersion)
          }}
          size="xs"
          variant="ghost"
        >
          <X aria-hidden size={12} />
        </Button>
      </div>
    </div>
  )
}
