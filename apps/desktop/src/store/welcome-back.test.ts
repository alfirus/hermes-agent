import { beforeEach, describe, expect, it } from 'vitest'

import {
  acknowledgedWelcomeVersion,
  acknowledgeWelcomeVersion,
  dropWelcomeBackForProfile,
  migrateWelcomeBackForProfile,
  shouldShowWelcomeBack
} from './welcome-back'

describe('shouldShowWelcomeBack (pure decision)', () => {
  it('shows when the running version differs from the last acknowledged one', () => {
    expect(shouldShowWelcomeBack({ acknowledgedVersion: '0.21.5', appVersion: '0.21.6', hasHistory: true })).toBe(true)
  })

  it('hides once the same version is acknowledged (exactly once per new version)', () => {
    expect(shouldShowWelcomeBack({ acknowledgedVersion: '0.21.6', appVersion: '0.21.6', hasHistory: true })).toBe(false)
  })

  it('never shows for first-run users without history', () => {
    expect(shouldShowWelcomeBack({ acknowledgedVersion: null, appVersion: '0.21.6', hasHistory: false })).toBe(false)
  })

  it('never shows before the version bridge resolves', () => {
    expect(shouldShowWelcomeBack({ acknowledgedVersion: null, appVersion: '', hasHistory: true })).toBe(false)
    expect(shouldShowWelcomeBack({ acknowledgedVersion: '0.21.5', appVersion: '  ', hasHistory: true })).toBe(false)
  })
})

describe('per-profile acknowledgement persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts unacknowledged and records one acknowledgement per version', () => {
    expect(acknowledgedWelcomeVersion('default')).toBe(null)

    acknowledgeWelcomeVersion('default', '0.21.6')

    expect(acknowledgedWelcomeVersion('default')).toBe('0.21.6')
    expect(shouldShowWelcomeBack({ acknowledgedVersion: acknowledgedWelcomeVersion('default'), appVersion: '0.21.6', hasHistory: true })).toBe(false)
  })

  it('re-arms for a NEW version only', () => {
    acknowledgeWelcomeVersion('default', '0.21.6')
    expect(shouldShowWelcomeBack({ acknowledgedVersion: acknowledgedWelcomeVersion('default'), appVersion: '0.21.7', hasHistory: true })).toBe(true)

    acknowledgeWelcomeVersion('default', '0.21.7')
    expect(acknowledgedWelcomeVersion('default')).toBe('0.21.7')
    expect(shouldShowWelcomeBack({ acknowledgedVersion: acknowledgedWelcomeVersion('default'), appVersion: '0.21.7', hasHistory: true })).toBe(false)
  })

  it('scopes acknowledgements per profile (no cross-profile bleed)', () => {
    acknowledgeWelcomeVersion('selena', '0.21.6')

    expect(acknowledgedWelcomeVersion('selena')).toBe('0.21.6')
    expect(acknowledgedWelcomeVersion('mirza')).toBe(null)
    expect(shouldShowWelcomeBack({ acknowledgedVersion: acknowledgedWelcomeVersion('mirza'), appVersion: '0.21.6', hasHistory: true })).toBe(true)
  })

  it('ignores empty versions', () => {
    acknowledgeWelcomeVersion('default', '  ')

    expect(acknowledgedWelcomeVersion('default')).toBe(null)
  })

  it('rename moves the marker to the new profile name', () => {
    acknowledgeWelcomeVersion('selena', '0.21.6')
    migrateWelcomeBackForProfile('selena', 'renamed')

    expect(acknowledgedWelcomeVersion('selena')).toBe(null)
    expect(acknowledgedWelcomeVersion('renamed')).toBe('0.21.6')
  })

  it('delete drops the marker so a later same-named profile starts fresh', () => {
    acknowledgeWelcomeVersion('selena', '0.21.6')
    dropWelcomeBackForProfile('selena')

    expect(acknowledgedWelcomeVersion('selena')).toBe(null)
    expect(shouldShowWelcomeBack({ acknowledgedVersion: acknowledgedWelcomeVersion('selena'), appVersion: '0.21.6', hasHistory: true })).toBe(true)
  })
})
