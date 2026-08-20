# DZ HOOF — Direct Playback / Provider / Subscription V2

## Objective

Keep the VPS as the control plane and avoid proxying video by default. The VPS is
responsible for authentication, subscription authorization, device/session policy,
provider/channel metadata and audit logs. The client obtains a short-lived playback
authorization and then follows the provider stream directly when the provider/source
explicitly permits direct delivery.

## Provider model

Every managed source must have:

- stable internal provider ID
- source type: `XTREAM` or `M3U`
- enabled/disabled state
- direct-playback capability flag
- health status and last health-check timestamp
- encrypted credentials where credentials exist

Credentials must never be returned by normal viewer APIs.

## Channel model

Every playable channel must have:

- stable internal channel ID
- provider ID
- provider-side stream reference
- normalized display name/group/logo/EPG metadata
- enabled/disabled state

Viewer APIs use the internal channel ID. Provider credentials and management
identifiers remain server-side.

## Subscription model

A subscription should resolve to:

- user/customer
- package
- start/end timestamps
- active/suspended/expired status
- maximum registered devices
- maximum concurrent playback sessions

Authorization must reject expired, suspended or over-limit subscriptions.

## Session model

Each successful playback authorization creates a short-lived session containing:

- user ID
- device ID
- internal channel ID
- provider ID
- created/last-seen timestamps
- authorization expiry
- revoked flag

Starting a new session must enforce the subscription concurrent-session limit.
Revocation must immediately prevent a new authorization and mark the existing
session unavailable for refresh.

## Delivery modes

`DIRECT`:
- authorization is performed by DZ HOOF
- the client receives a short-lived playback authorization
- the media bytes do not pass through the DZ HOOF VPS

`PROXY`:
- used only when explicitly required by a compatible provider/source or policy
- subject to separate bandwidth and capacity controls

Direct playback must not be enabled globally without an explicit environment
flag and per-provider/source capability.

## Required operational metrics

Track:

- authorization success/failure
- playback-session starts/stops
- active concurrent sessions
- provider health
- channel failures
- subscription denials
- device-limit denials
- concurrent-session denials
- direct/proxy delivery ratio

Never log provider passwords, access tokens, signed URLs or full playback URLs.

## Acceptance criteria

1. A valid subscriber can start a permitted direct stream.
2. An expired/suspended subscriber is denied.
3. A device beyond the device limit is denied.
4. A user beyond the concurrent-session limit is denied.
5. Revoked sessions cannot be refreshed.
6. Viewer responses do not expose provider credentials.
7. Provider/channel relationships remain stable after M3U/Xtream synchronization.
8. Proxy mode remains opt-in.
9. Health-check failures do not silently grant playback.
10. Existing secure playback protections remain enabled.
